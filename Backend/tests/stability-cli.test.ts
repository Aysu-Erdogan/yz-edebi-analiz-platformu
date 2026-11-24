import { describe, expect, it, vi } from 'vitest';
import type { ExportEvaluation } from '../src/domain/export.js';
import type { ExportRepository } from '../src/repositories/export.repository.js';
import { runStabilityCli } from '../src/services/stability-cli.js';

const base: ExportEvaluation = {
  evaluationId: 1,
  textId: 10,
  genre: 'siir',
  theme: 'Sonbahar',
  textBody: 'Yaprak düşer.',
  author: null,
  label: null,
  judge: 'deepseek/deepseek-flash',
  replicateNo: 1,
  status: 'succeeded',
  error: null,
  totalScore: 90,
  rubricVersion: '0.1-taslak',
  rubricNote: null,
  judgeTemplateVersion: 'v1',
  generationTemplateVersion: 'v1',
  attempts: 1,
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 1000,
  scores: [{ criterionKey: 'imge', score: 5, comment: null }],
};
const second: ExportEvaluation = {
  ...base,
  evaluationId: 2,
  replicateNo: 2,
  totalScore: 80,
  scores: [{ criterionKey: 'imge', score: 4, comment: null }],
};
const now = new Date('2026-11-23T12:00:00.000Z');

function setup(records: ExportEvaluation[] = [base, second]) {
  const writes: { path: string; data: string }[] = [];
  const logs: string[] = [];
  const deps = {
    exports: { listEvaluations: vi.fn(async () => records) } satisfies ExportRepository,
    write: (path: string, data: string) => {
      writes.push({ path, data });
    },
    now: () => now,
  };
  const run = (...argv: string[]) => runStabilityCli(argv, deps, (line) => logs.push(line));
  return { writes, logs, deps, run };
}

describe('kararlılık komut satırı', () => {
  it('seçeneksiz: raporu ekrana yazar, dosya yazmaz, 0 döner', async () => {
    const { writes, logs, run } = setup();
    expect(await run()).toBe(0);
    expect(writes).toHaveLength(0);
    const text = logs.join('\n');
    expect(text).toContain('deepseek/deepseek-flash');
    expect(text).toContain('tekrar sapması (s_r) 7.07'); // [90,80]: sd = karekök(50) = 7,07
    expect(text).toContain('en büyük aralık 10.00');
  });

  it('--cikti: aynı sonucu JSON olarak yazar ve yolu bildirir', async () => {
    const { writes, logs, run } = setup();
    expect(await run('--cikti', 'exports/kararlilik.json')).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('exports/kararlilik.json');
    const parsed = JSON.parse(writes[0]?.data ?? '');
    expect(parsed.olusturulma).toBe('2026-11-23T12:00:00.000Z');
    expect(parsed.kosullar[0].olculebilenGrup).toBe(1);
    expect(logs.join('\n')).toContain('exports/kararlilik.json');
  });

  it('yalnızca okur: depodan bir kez sorgular', async () => {
    const { deps, run } = setup();
    await run();
    expect(deps.exports.listEvaluations).toHaveBeenCalledTimes(1);
  });

  it('kayıt yoksa uyarır ve yine de 0 döner; --cikti ile boş rapor dosyası yazılır', async () => {
    const { writes, logs, run } = setup([]);
    expect(await run('--cikti', 'k.json')).toBe(0);
    expect(logs.join('\n')).toContain('hiç puanlama kaydı yok');
    expect(JSON.parse(writes[0]?.data ?? '').kosullar).toEqual([]);
  });

  it('hiçbir metinde 2 başarılı tekrar yoksa ölçülemedi der ama hata saymaz', async () => {
    const { logs, run } = setup([base]);
    expect(await run()).toBe(0);
    expect(logs.join('\n')).toContain('ölçülemedi');
  });

  it('hatalı kullanım 2 döner ve kullanımı yazar: bilinmeyen seçenek, fazladan sözcük, değersiz --cikti', async () => {
    for (const argv of [['--yok'], ['csv'], ['--cikti']]) {
      const { logs, writes, run } = setup();
      expect(await run(...argv), argv.join(' ')).toBe(2);
      expect(logs.join('\n')).toContain('Kullanım: npm run stability');
      expect(writes).toHaveLength(0);
    }
  });

  it('hatalı kullanımda depoya sorgu atılmaz', async () => {
    const { deps, run } = setup();
    await run('--yok');
    expect(deps.exports.listEvaluations).not.toHaveBeenCalled();
  });
});
