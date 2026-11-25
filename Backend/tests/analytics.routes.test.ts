import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { exportCsv, type ExportEvaluation } from '../src/domain/export.js';
import type { ExportRepository } from '../src/repositories/export.repository.js';
import { buildTestApp } from './helpers.js';

const rec = (
  evaluationId: number,
  textId: number,
  model: string,
  total: number,
  theme = 'Aşk',
): ExportEvaluation => ({
  evaluationId,
  textId,
  genre: 'siir',
  theme,
  textBody: 'Yaprak düşer.',
  author: { provider: 'p', modelId: model },
  label: null,
  judge: 'deepseek/deepseek-flash',
  replicateNo: 1,
  status: 'succeeded',
  error: null,
  totalScore: total,
  rubricVersion: '0.1-taslak',
  rubricNote: null,
  judgeTemplateVersion: 'v1',
  generationTemplateVersion: 'v1',
  attempts: 1,
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 1,
  scores: [{ criterionKey: 'imge', score: 4, comment: null }],
});

const records = [rec(1, 1, 'a', 80), rec(2, 2, 'a', 70), rec(3, 3, 'b', 30), rec(4, 4, 'b', 20)];

function app(data: ExportEvaluation[] = records) {
  const exports = { listEvaluations: vi.fn(async () => data) } satisfies ExportRepository;
  return { exports, app: buildTestApp({ exports }) };
}

describe('GET /analytics/stats', () => {
  it('istatistik ve kriter profilini tek zarfta verir', async () => {
    const res = await request(app().app).get('/api/v1/analytics/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [k] = res.body.data.kosullar;
    expect(k).toMatchObject({
      hakem: 'deepseek/deepseek-flash',
      rubrikSurumu: '0.1-taslak',
      metin: 4,
    });
    expect(k.kirilimlar[0].gruplar[0]).toMatchObject({ anahtar: 'p/a', n: 2, ortalama: 75 });
    expect(k.karsilastirmalar[0].kruskalWallis).toMatchObject({ sd: 1 });
    expect(k.profiller[0]).toMatchObject({ kapsam: 'tür siir', kriterler: ['imge'] });
    expect(typeof res.body.data.olusturulma).toBe('string');
  });

  it('kayıt yokken boş koşul listesi döner', async () => {
    const res = await request(app([]).app).get('/api/v1/analytics/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.kosullar).toEqual([]);
  });

  it('tema süzgeci (virgülle ayrılmış) yalnızca o temalı metinleri analiz eder', async () => {
    const data = [...records.map((r) => ({ ...r, theme: 'Aşk' })), rec(9, 9, 'a', 10, 'Sonbahar')];
    const all = await request(app(data).app).get('/api/v1/analytics/stats');
    expect(all.body.data.kosullar[0].metin).toBe(5);
    const only = await request(app(data).app).get('/api/v1/analytics/stats?tema=Aşk,Doğa');
    expect(only.body.data.kosullar[0].metin).toBe(4);
    const none = await request(app(data).app).get('/api/v1/analytics/stats?tema=Yok');
    expect(none.body.data.kosullar).toEqual([]);
  });

  it('aynı parametre iki kez verilirse 400 döner', async () => {
    const res = await request(app().app).get('/api/v1/analytics/stats?tema=a&tema=b');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('depo hata verirse 500 döner ve iç ayrıntıyı sızdırmaz', async () => {
    const exports: ExportRepository = {
      listEvaluations: async () => {
        throw new Error('GİZLİ-VERİTABANI-AYRINTISI');
      },
    };
    const res = await request(buildTestApp({ exports })).get('/api/v1/analytics/stats');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('GİZLİ-VERİTABANI-AYRINTISI');
  });

  it('dışa aktarma deposu yoksa (veritabanı yok) uç açılmaz: 404', async () => {
    const res = await request(buildTestApp()).get('/api/v1/analytics/stats');
    expect(res.status).toBe(404);
  });
});

describe('GET /export', () => {
  it('csv: dosya olarak iner, UTF-8 BOM ile başlar ve dışa aktarma biçimiyle aynıdır', async () => {
    const res = await request(app().app).get('/api/v1/export?format=csv').buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-type']).toContain('utf-8');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('puanlar.csv');
    expect(res.text).toBe(exportCsv(records, { bom: true }));
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
  });

  it('json: dosya olarak iner, kayıtları ve metni içerir', async () => {
    const res = await request(app().app).get('/api/v1/export?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('puanlar.json');
    const body = JSON.parse(res.text);
    expect(body.kayitlar).toHaveLength(4);
    expect(body.kayitlar[0].metin).toBe('Yaprak düşer.');
  });

  it('biçim yoksa ya da geçersizse 400 döner, depoya sorgu atılmaz', async () => {
    for (const query of ['', '?format=xml', '?format=csv&format=json']) {
      const { app: a, exports } = app();
      const res = await request(a).get(`/api/v1/export${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(exports.listEvaluations).not.toHaveBeenCalled();
    }
  });

  it('dışa aktarma deposu yoksa 404 döner', async () => {
    expect((await request(buildTestApp()).get('/api/v1/export?format=csv')).status).toBe(404);
  });
});
