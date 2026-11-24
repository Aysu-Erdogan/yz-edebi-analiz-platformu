import { describe, expect, it, vi } from 'vitest';
import type { ExportEvaluation } from '../src/domain/export.js';
import type { ExportRepository } from '../src/repositories/export.repository.js';
import { runExportCli } from '../src/services/export-cli.js';

const BOM = String.fromCharCode(0xfeff);

const record: ExportEvaluation = {
  evaluationId: 1,
  textId: 10,
  genre: 'siir',
  theme: 'Sonbahar',
  textBody: 'Yaprak düşer.',
  author: { provider: 'openai', modelId: 'gpt-x' },
  label: null,
  judge: 'anthropic/claude-z',
  replicateNo: 1,
  status: 'succeeded',
  error: null,
  totalScore: 62.5,
  rubricVersion: '0.1-taslak',
  rubricNote: 'GEÇİCİ TASLAK',
  judgeTemplateVersion: 'v1',
  generationTemplateVersion: 'v1',
  attempts: 1,
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 1000,
  scores: [
    { criterionKey: 'imge', score: 4, comment: 'iyi' },
    { criterionKey: 'ritim', score: 3, comment: null },
  ],
};
const failed: ExportEvaluation = { ...record, evaluationId: 2, status: 'failed', scores: [] };
const now = new Date('2026-11-23T12:00:00.000Z');

function setup(records: ExportEvaluation[] = [record, failed]) {
  const writes: { path: string; data: string }[] = [];
  const logs: string[] = [];
  const deps = {
    exports: { listEvaluations: vi.fn(async () => records) } satisfies ExportRepository,
    write: (path: string, data: string) => {
      writes.push({ path, data });
    },
    now: () => now,
  };
  const run = (...argv: string[]) => runExportCli(argv, deps, (line) => logs.push(line));
  return { writes, logs, deps, run };
}

describe('dışa aktarma komut satırı', () => {
  it('csv: dosyayı yazar, kayıt ve satır sayısını bildirir, 0 döner', async () => {
    const { writes, logs, run } = setup();
    expect(await run('csv', '--cikti', 'exports/p.csv')).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('exports/p.csv');
    expect(writes[0]?.data.split('\r\n')[0]).toContain('puanlama_id,metin_id');
    expect(writes[0]?.data.startsWith(BOM)).toBe(false);
    expect(logs.join('\n')).toContain('2 puanlama kaydı');
    expect(logs.join('\n')).toContain('exports/p.csv');
  });

  it('json: oluşturulma zamanı verilen saatten gelir', async () => {
    const { writes, run } = setup();
    expect(await run('json', '--cikti', 'p.json')).toBe(0);
    const parsed = JSON.parse(writes[0]?.data ?? '');
    expect(parsed.olusturulma).toBe('2026-11-23T12:00:00.000Z');
    expect(parsed.kayitlar).toHaveLength(2);
  });

  it('--bom: dosya BOM ile başlar, ayırıcı virgül kalır', async () => {
    const { writes, run } = setup();
    expect(await run('csv', '--cikti', 'p.csv', '--bom')).toBe(0);
    expect(writes[0]?.data.startsWith(`${BOM}puanlama_id,`)).toBe(true);
  });

  it('--excel: BOM, noktalı virgül ve ondalık virgül', async () => {
    const { writes, run } = setup();
    expect(await run('csv', '--cikti', 'p.csv', '--excel')).toBe(0);
    const data = writes[0]?.data ?? '';
    expect(data.startsWith(`${BOM}puanlama_id;`)).toBe(true);
    expect(data).toContain('62,5');
  });

  it('kayıt yoksa uyarır ama yine de yalnızca başlıkla yazar', async () => {
    const { writes, logs, run } = setup([]);
    expect(await run('csv', '--cikti', 'p.csv')).toBe(0);
    expect(writes[0]?.data.split('\r\n')).toHaveLength(2);
    expect(logs.join('\n')).toContain('Uyarı');
  });

  it.each([
    ['biçim yok', [] as string[]],
    ['bilinmeyen biçim', ['xml', '--cikti', 'p.xml']],
    ['--cikti yok', ['csv']],
    ['--cikti değersiz', ['csv', '--cikti']],
    ['bilinmeyen seçenek', ['csv', '--cikti', 'p.csv', '--hepsi']],
    ['fazladan sözcük', ['csv', 'json', '--cikti', 'p.csv']],
    ['json ile --bom', ['json', '--cikti', 'p.json', '--bom']],
    ['json ile --excel', ['json', '--cikti', 'p.json', '--excel']],
  ])('hatalı kullanım (%s): 2 döner, dosya yazılmaz, kullanım gösterilir', async (_name, argv) => {
    const { writes, logs, deps, run } = setup();
    expect(await run(...argv)).toBe(2);
    expect(writes).toHaveLength(0);
    expect(deps.exports.listEvaluations).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Kullanım');
  });

  it('depo hatasını yutmaz ve dosya yazmaz', async () => {
    const { writes, deps, run } = setup();
    deps.exports.listEvaluations.mockRejectedValueOnce(new Error('veritabanı yok'));
    await expect(run('csv', '--cikti', 'p.csv')).rejects.toThrow('veritabanı yok');
    expect(writes).toHaveLength(0);
  });
});
