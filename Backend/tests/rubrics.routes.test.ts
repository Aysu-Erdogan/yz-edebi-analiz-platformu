import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRubricService, type RubricService } from '../src/services/rubric.service.js';
import { sampleRubric } from './contracts/rubric-repository.contract.js';
import { InMemoryRubricRepository } from './fakes/in-memory-rubric.repository.js';
import { buildTestApp } from './helpers.js';

describe('rubrik okuma uçları', () => {
  let service: RubricService;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    service = createRubricService(new InMemoryRubricRepository());
    app = buildTestApp({ rubrics: service });
  });

  it('GET /rubrics: boşken boş liste döner', async () => {
    const res = await request(app).get('/api/v1/rubrics');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('GET /rubrics: tür ve durum süzgeciyle daraltır', async () => {
    const siir = await service.importRubric(sampleRubric('siir', '1.0'));
    await service.importRubric(sampleRubric('hikaye', '1.0'));
    await service.activateRubric(siir.id);

    expect((await request(app).get('/api/v1/rubrics')).body.data).toHaveLength(2);
    const byGenre = await request(app).get('/api/v1/rubrics?genre=hikaye');
    expect(byGenre.body.data.map((r: { genre: string }) => r.genre)).toEqual(['hikaye']);
    const active = await request(app).get('/api/v1/rubrics?genre=siir&status=active');
    expect(active.body.data.map((r: { id: number }) => r.id)).toEqual([siir.id]);
  });

  it('GET /rubrics: geçersiz tür ya da durum 400 döner', async () => {
    for (const query of ['genre=roman', 'status=bilinmez', 'genre=a&genre=b']) {
      const res = await request(app).get(`/api/v1/rubrics?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('GET /rubrics/:id: kriterler ve düzeylerle birlikte döner', async () => {
    const saved = await service.importRubric(sampleRubric());
    const res = await request(app).get(`/api/v1/rubrics/${saved.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: saved.id,
      genre: 'siir',
      version: '0.1-taslak',
      status: 'draft',
      usedAt: null,
    });
    expect(res.body.data.criteria[0].levels).toEqual([
      { score: 1, descriptor: 'zayıf' },
      { score: 5, descriptor: 'çok iyi' },
    ]);
  });

  it('GET /rubrics/:id: olmayan rubrik 404 döner', async () => {
    const res = await request(app).get('/api/v1/rubrics/999');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /rubrics/:id: sayı olmayan ya da pozitif olmayan kimlik 400 döner', async () => {
    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await request(app).get(`/api/v1/rubrics/${id}`);
      expect(res.status, id).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('yazma uçları (içe aktarma, etkinleştirme) giriş sistemi gelene kadar AÇIK DEĞİL (F4)', async () => {
    const saved = await service.importRubric(sampleRubric());
    expect((await request(app).post('/api/v1/rubrics/import').send(sampleRubric())).status).toBe(
      404,
    );
    expect((await request(app).post(`/api/v1/rubrics/${saved.id}/activate`)).status).toBe(404);
    expect((await service.getRubric(saved.id)).status).toBe('draft'); // değişmedi
  });
});
