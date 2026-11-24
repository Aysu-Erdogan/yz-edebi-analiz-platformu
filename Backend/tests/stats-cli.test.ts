import { describe, expect, it, vi } from 'vitest';
import type { ExportEvaluation } from '../src/domain/export.js';
import type { ExportRepository } from '../src/repositories/export.repository.js';
import { runStatsCli } from '../src/services/stats-cli.js';

const rec = (
  evaluationId: number,
  textId: number,
  model: string,
  replicateNo: number,
  totalScore: number,
): ExportEvaluation => ({
  evaluationId,
  textId,
  genre: 'siir',
  theme: 'Sonbahar',
  textBody: 'metin',
  author: { provider: 'p', modelId: model },
  label: null,
  judge: 'deepseek/deepseek-flash',
  replicateNo,
  status: 'succeeded',
  error: null,
  totalScore,
  rubricVersion: '0.1-taslak',
  rubricNote: null,
  judgeTemplateVersion: 'v1',
  generationTemplateVersion: 'v1',
  attempts: 1,
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 1,
  scores: [],
});

// İki yazar, her biri iki metin: a 80, 70 · b 30, 20
const records = [
  rec(1, 1, 'a', 1, 80),
  rec(2, 2, 'a', 1, 70),
  rec(3, 3, 'b', 1, 30),
  rec(4, 4, 'b', 1, 20),
];
const now = new Date('2026-11-24T12:00:00.000Z');

function setup(data: ExportEvaluation[] = records) {
  const writes: { path: string; data: string }[] = [];
  const logs: string[] = [];
  const deps = {
    exports: { listEvaluations: vi.fn(async () => data) } satisfies ExportRepository,
    write: (path: string, content: string) => {
      writes.push({ path, data: content });
    },
    now: () => now,
  };
  const run = (...argv: string[]) => runStatsCli(argv, deps, (line) => logs.push(line));
  return { deps, writes, run, out: () => logs.join('\n') };
}

describe('istatistik komut satırı', () => {
  it('seçeneksiz: raporu ekrana yazar, dosya yazmaz, 0 döner', async () => {
    const { writes, run, out } = setup();
    expect(await run()).toBe(0);
    expect(writes).toHaveLength(0);
    expect(out()).toContain('deepseek/deepseek-flash');
    expect(out()).toContain('p/a: n 2 · ort 75.0');
    expect(out()).toContain('Kruskal-Wallis: H');
    expect(out()).toContain('p/a ↔ p/b');
  });

  it('--cikti: aynı sonucu JSON olarak yazar ve yolu bildirir', async () => {
    const { writes, run, out } = setup();
    expect(await run('--cikti', 'exports/istatistik.json')).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('exports/istatistik.json');
    const parsed = JSON.parse(writes[0]?.data ?? '');
    expect(parsed.olusturulma).toBe('2026-11-24T12:00:00.000Z');
    expect(parsed.kosullar[0].metin).toBe(4);
    expect(out()).toContain('exports/istatistik.json');
  });

  it('kayıt yoksa uyarır ve 0 döner; --cikti ile boş sonuç dosyası yazılır', async () => {
    const { writes, run, out } = setup([]);
    expect(await run('--cikti', 's.json')).toBe(0);
    expect(out()).toContain('hiç puanlama kaydı yok');
    expect(JSON.parse(writes[0]?.data ?? '').kosullar).toEqual([]);
  });

  it('--tema: yalnızca verilen temalı metinler analiz edilir (deneme verisi dışarıda kalır)', async () => {
    const trial = { ...rec(9, 9, 'a', 1, 10), theme: 'Sonbahar' };
    const data = [...records.map((r) => ({ ...r, theme: 'Aşk' })), trial];
    const all = setup(data);
    await all.run();
    expect(all.out()).toContain('5 metin');
    const only = setup(data);
    expect(await only.run('--tema', ' Aşk , Doğa ')).toBe(0);
    expect(only.out()).toContain('4 metin');
    expect(only.out()).not.toContain('tema Sonbahar');
    const none = setup(data);
    expect(await none.run('--tema', 'Yok')).toBe(0);
    expect(none.out()).toContain('hiç puanlama kaydı yok');
  });

  it('hatalı kullanım 2 döner ve kullanımı yazar: bilinmeyen seçenek, fazladan sözcük, değersiz --cikti', async () => {
    for (const argv of [['--yok'], ['csv'], ['--cikti']]) {
      const { run, out, writes } = setup();
      expect(await run(...argv), argv.join(' ')).toBe(2);
      expect(out()).toContain('Kullanım: npm run stats');
      expect(writes).toHaveLength(0);
    }
  });

  it('hatalı kullanımda depoya sorgu atılmaz; normal çalışmada bir kez sorgulanır', async () => {
    const bad = setup();
    await bad.run('--yok');
    expect(bad.deps.exports.listEvaluations).not.toHaveBeenCalled();
    const ok = setup();
    await ok.run();
    expect(ok.deps.exports.listEvaluations).toHaveBeenCalledTimes(1);
  });
});
