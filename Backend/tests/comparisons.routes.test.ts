import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import type { ComparisonResult, ComparisonService } from '../src/services/comparison.service.js';
import { buildTestApp } from './helpers.js';

const result: ComparisonResult = {
  genre: 'siir',
  theme: 'Doğa',
  judge: 'deepseek/deepseek-flash',
  rubric: {
    id: 1,
    version: '0.1-taslak',
    scale: { min: 1, max: 5 },
    criteria: [{ key: 'imge', label: 'İmge gücü', weight: 100 }],
  },
  items: [
    {
      label: 'ChatGPT',
      textId: 1,
      status: 'succeeded',
      totalScore: 80,
      scores: [{ key: 'imge', score: 4, normalized: 75, comment: 'iyi' }],
      costUsd: 0.001,
    },
  ],
  totalCostUsd: 0.001,
};

function app(compare: ComparisonService['compare'] = async () => result) {
  const service = { compare: vi.fn(compare) };
  return { service, app: buildTestApp({ comparisons: service }) };
}

describe('POST /comparisons', () => {
  it('gövdeyi servise verir ve sonucu zarfta döner', async () => {
    const { service, app: a } = app();
    const body = { genre: 'siir', theme: 'Doğa', items: [{ body: 'a' }, { body: 'b' }] };
    const res = await request(a).post('/api/v1/comparisons').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: result });
    expect(service.compare).toHaveBeenCalledWith(body);
  });

  it('doğrulama hatasında 400 VALIDATION_ERROR döner', async () => {
    const real = await import('../src/services/comparison.service.js');
    const service = real.createComparisonService({
      texts: { createManual: vi.fn() },
      evaluation: { evaluate: vi.fn() },
      models: { findByIds: vi.fn(), findByModelIds: vi.fn() },
      rubrics: {} as never,
      providers: { get: vi.fn() },
      judgeModel: 'x',
    });
    const res = await request(buildTestApp({ comparisons: service }))
      .post('/api/v1/comparisons')
      .send({ genre: 'siir', theme: 'Doğa', items: [{ body: 'tek' }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('hakem kullanılamıyorsa 503 ve açık mesaj döner', async () => {
    const { app: a } = app(() =>
      Promise.reject(AppError.unavailable('Hakem model kullanılamıyor')),
    );
    const res = await request(a)
      .post('/api/v1/comparisons')
      .send({ genre: 'siir', theme: 'Doğa', items: [{ body: 'a' }, { body: 'b' }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Hakem model kullanılamıyor',
    });
  });

  it('beklenmeyen hata 500 döner ve iç ayrıntıyı sızdırmaz', async () => {
    const { app: a } = app(() => Promise.reject(new Error('GİZLİ-AYRINTI sk-123')));
    const res = await request(a)
      .post('/api/v1/comparisons')
      .send({ genre: 'siir', theme: 'Doğa', items: [{ body: 'a' }, { body: 'b' }] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('GİZLİ-AYRINTI');
  });

  it('bozuk JSON 400 döner, servise gitmez', async () => {
    const { service, app: a } = app();
    const res = await request(a)
      .post('/api/v1/comparisons')
      .set('Content-Type', 'application/json')
      .send('{bozuk');
    expect(res.status).toBe(400);
    expect(service.compare).not.toHaveBeenCalled();
  });

  it('servis yoksa (veritabanı yok) uç açılmaz: 404', async () => {
    const res = await request(buildTestApp()).post('/api/v1/comparisons').send({});
    expect(res.status).toBe(404);
  });
});
