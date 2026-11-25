import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type {
  LibraryText,
  LibraryTextDetail,
  TextFilter,
  TextLibraryRepository,
} from '../src/repositories/text-library.repository.js';
import { buildTestApp } from './helpers.js';

const text = (id: number, over: Partial<LibraryText> = {}): LibraryText => ({
  id,
  genre: 'siir',
  theme: 'Doğa',
  source: 'generated',
  label: null,
  author: { provider: 'anthropic', modelId: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5' },
  body: 'Yaprak düşer,\nrüzgâr eser.',
  createdAt: new Date('2026-11-24T10:00:00.000Z'),
  succeededEvaluations: 3,
  ...over,
});

const detail = (id: number): LibraryTextDetail => ({
  ...text(id),
  generation: {
    templateVersion: 'v1',
    replicateNo: 1,
    inputTokens: 100,
    outputTokens: 200,
    latencyMs: 6100,
  },
  evaluations: [
    {
      id: 7,
      judge: 'deepseek/deepseek-flash',
      rubricVersion: '0.1-taslak',
      templateVersion: 'v1',
      replicateNo: 1,
      status: 'succeeded',
      error: null,
      totalScore: 75,
      scores: [{ key: 'imge', label: 'İmge Gücü', score: 4, comment: 'iyi imge' }],
      createdAt: new Date('2026-11-24T10:05:00.000Z'),
    },
  ],
});

function app(
  list: (f: TextFilter) => Promise<LibraryText[]> = async () => [text(1), text(2)],
  get: (id: number) => Promise<LibraryTextDetail | null> = async (id) => detail(id),
) {
  const library = { list: vi.fn(list), get: vi.fn(get) } satisfies TextLibraryRepository;
  return { library, app: buildTestApp({ texts: library }) };
}

describe('GET /texts', () => {
  it('metinleri gövdesiz özet olarak verir: sözcük sayısı ve özet, yazar ve puanlama sayısıyla', async () => {
    const res = await request(app().app).get('/api/v1/texts');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    const [first] = res.body.data;
    expect(first).toEqual({
      id: 1,
      genre: 'siir',
      theme: 'Doğa',
      source: 'generated',
      label: null,
      author: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5-5',
        displayName: 'Claude Sonnet 5.5',
      },
      wordCount: 4,
      excerpt: 'Yaprak düşer, rüzgâr eser.',
      createdAt: '2026-11-24T10:00:00.000Z',
      succeededEvaluations: 3,
    });
    expect(first).not.toHaveProperty('body');
  });

  it('süzgeçleri depoya olduğu gibi (kırpılmış) iletir; süzgeç yoksa boş süzgeç', async () => {
    const { library, app: a } = app();
    await request(a).get('/api/v1/texts');
    expect(library.list).toHaveBeenLastCalledWith({});
    await request(a).get('/api/v1/texts?genre=hikaye&theme=%20Aşk%20&source=manual');
    expect(library.list).toHaveBeenLastCalledWith({
      genre: 'hikaye',
      theme: 'Aşk',
      source: 'manual',
    });
  });

  it('elle girilen metinde yazar boştur, etiket görünür', async () => {
    const { app: a } = app(async () => [
      text(5, { source: 'manual', author: null, label: 'ChatGPT' }),
    ]);
    const res = await request(a).get('/api/v1/texts');
    expect(res.body.data[0]).toMatchObject({ source: 'manual', author: null, label: 'ChatGPT' });
  });

  it('kayıt yoksa boş liste döner (hata değil)', async () => {
    const res = await request(app(async () => []).app).get('/api/v1/texts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it.each([
    ['geçersiz tür (Türkçe karakterli)', '?genre=şiir'],
    ['geçersiz kaynak', '?source=bilinmeyen'],
    ['boş tema', '?theme='],
    ['33 karakterlik tema', `?theme=${'x'.repeat(33)}`],
    ['aynı parametre iki kez', '?genre=siir&genre=hikaye'],
  ])('%s: 400 döner, depoya sorgu atılmaz', async (_name, query) => {
    const { library, app: a } = app();
    const res = await request(a).get(`/api/v1/texts${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(library.list).not.toHaveBeenCalled();
  });

  it('depo hata verirse 500 döner ve iç ayrıntıyı sızdırmaz', async () => {
    const { app: a } = app(() => Promise.reject(new Error('GİZLİ-VERİTABANI-AYRINTISI')));
    const res = await request(a).get('/api/v1/texts');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('GİZLİ-VERİTABANI-AYRINTISI');
  });

  it('kütüphane deposu yoksa (veritabanı yok) uç açılmaz: 404', async () => {
    expect((await request(buildTestApp()).get('/api/v1/texts')).status).toBe(404);
  });
});

describe('GET /texts/:id', () => {
  it('metnin gövdesini, üretim bilgisini ve puanlamalarını verir', async () => {
    const { library, app: a } = app();
    const res = await request(a).get('/api/v1/texts/7');
    expect(res.status).toBe(200);
    expect(library.get).toHaveBeenCalledWith(7);
    expect(res.body.data).toMatchObject({
      id: 7,
      body: 'Yaprak düşer,\nrüzgâr eser.',
      wordCount: 4,
      generation: { templateVersion: 'v1', latencyMs: 6100 },
      evaluations: [
        {
          judge: 'deepseek/deepseek-flash',
          rubricVersion: '0.1-taslak',
          totalScore: 75,
          scores: [{ key: 'imge', label: 'İmge Gücü', score: 4, comment: 'iyi imge' }],
        },
      ],
    });
  });

  it('metin yoksa 404 döner', async () => {
    const res = await request(app(undefined, async () => null).app).get('/api/v1/texts/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('99');
  });

  it.each(['abc', '0', '-3', '1.5'])(
    'geçersiz kimlik %s: 400 döner, depoya gidilmez',
    async (id) => {
      const { library, app: a } = app();
      const res = await request(a).get(`/api/v1/texts/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(library.get).not.toHaveBeenCalled();
    },
  );

  it('kütüphane deposu yoksa 404 döner', async () => {
    expect((await request(buildTestApp()).get('/api/v1/texts/1')).status).toBe(404);
  });
});
