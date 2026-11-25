import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import type { LLMProvider } from '../src/providers/provider.js';
import type { ProviderModelRecord } from '../src/repositories/provider-model.repository.js';
import type { NewManualText } from '../src/repositories/text.repository.js';
import { createComparisonService } from '../src/services/comparison.service.js';
import type { EvaluationResult } from '../src/services/evaluation.service.js';
import type { RubricService } from '../src/services/rubric.service.js';

const judge: ProviderModelRecord = {
  id: 7,
  provider: 'deepseek',
  modelId: 'deepseek-flash',
  displayName: 'DeepSeek Flash',
  active: true,
  params: {},
};

const rubric = {
  id: 3,
  genre: 'siir',
  version: '0.1-taslak',
  scale: { min: 1, max: 5 },
  criteria: [
    { key: 'imge', label: 'İmge gücü', description: 'd', weight: 60, levels: [] },
    { key: 'ritim', label: 'Ritim ve ahenk', description: 'd', weight: 40, levels: [] },
  ],
};

const succeeded = (textId: number, total: number, costUsd: number | null): EvaluationResult => ({
  evaluationId: textId,
  status: 'succeeded',
  totalScore: total,
  scores: [{ key: 'imge', score: 4, normalized: 75, comment: 'iyi' }],
  attempts: 1,
  inputTokens: 1000,
  outputTokens: 200,
  costUsd,
});

const failed = (textId: number): EvaluationResult => ({
  evaluationId: textId,
  status: 'failed',
  error: 'hakem geçersiz cevap verdi',
  attempts: 2,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
});

const item = (body: string, label?: string) => ({ body, ...(label !== undefined && { label }) });
const valid = {
  genre: 'siir',
  theme: 'Doğa',
  items: [item('Yaprak düşer.', 'ChatGPT'), item('Rüzgâr eser.', 'Claude'), item('Deniz uyur.')],
};

function setup(
  options: {
    evaluate?: (input: { textId: number; judgeModelId: number }) => Promise<EvaluationResult>;
    models?: ProviderModelRecord[];
    providers?: () => LLMProvider;
    rubrics?: () => Promise<typeof rubric>;
  } = {},
) {
  const created: NewManualText[][] = [];
  const texts = {
    createManual: vi.fn(async (items: NewManualText[]) => {
      created.push(items);
      return items.map((_, i) => 100 + i);
    }),
  };
  const evaluate = vi.fn(
    options.evaluate ?? ((input) => Promise.resolve(succeeded(input.textId, 80, 0.001))),
  );
  const models = {
    findByIds: vi.fn(async () => []),
    findByModelIds: vi.fn(async () => options.models ?? [judge]),
  };
  const providers = { get: vi.fn(options.providers ?? (() => ({}) as LLMProvider)) };
  const getActiveRubric = vi.fn(options.rubrics ?? (async () => rubric));
  const service = createComparisonService({
    texts,
    models,
    providers,
    evaluation: { evaluate: (raw) => evaluate(raw as { textId: number; judgeModelId: number }) },
    rubrics: { getActiveRubric } as unknown as RubricService,
    judgeModel: 'deepseek-flash',
  });
  return { service, texts, created, evaluate, models, providers, getActiveRubric };
}

describe('karşılaştırma servisi', () => {
  it('metinleri elle girilen olarak kaydeder, her birini sabit hakemle puanlatır, sırayı korur', async () => {
    const { service, created, evaluate } = setup({
      evaluate: (i) => Promise.resolve(succeeded(i.textId, 70 + (i.textId - 100) * 5, 0.001)),
    });
    const result = await service.compare(valid);

    expect(created[0]).toEqual([
      { genre: 'siir', theme: 'Doğa', body: 'Yaprak düşer.', label: 'ChatGPT' },
      { genre: 'siir', theme: 'Doğa', body: 'Rüzgâr eser.', label: 'Claude' },
      { genre: 'siir', theme: 'Doğa', body: 'Deniz uyur.', label: null },
    ]);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(result.judge).toBe('deepseek/deepseek-flash');
    expect(result.items.map((i) => [i.textId, i.label])).toEqual([
      [100, 'ChatGPT'],
      [101, 'Claude'],
      [102, null],
    ]);
    expect(result.items.map((i) => i.status === 'succeeded' && i.totalScore)).toEqual([70, 75, 80]);
    expect(result.rubric).toEqual({
      id: 3,
      version: '0.1-taslak',
      scale: { min: 1, max: 5 },
      criteria: [
        { key: 'imge', label: 'İmge gücü', weight: 60 },
        { key: 'ritim', label: 'Ritim ve ahenk', weight: 40 },
      ],
    });
    expect(result.totalCostUsd).toBeCloseTo(0.003);
  });

  it('hakem kördür: hakeme yalnızca metin kimliği ve hakem gider, etiket gitmez', async () => {
    const { service, evaluate } = setup();
    await service.compare(valid);
    for (const [input] of evaluate.mock.calls) {
      expect(Object.keys(input).sort()).toEqual(['judgeModelId', 'textId']);
      expect(input.judgeModelId).toBe(7);
    }
  });

  it('metni ve etiketi kırpar, boş etiketi null yapar', async () => {
    const { service, created } = setup();
    await service.compare({
      genre: 'deneme',
      theme: ' Aşk ',
      items: [item('  Bir metin.  ', '   '), item('İkinci.')],
    });
    expect(created[0]).toEqual([
      { genre: 'deneme', theme: 'Aşk', body: 'Bir metin.', label: null },
      { genre: 'deneme', theme: 'Aşk', body: 'İkinci.', label: null },
    ]);
  });

  it('iki metin yeter', async () => {
    const { service } = setup();
    const result = await service.compare({ ...valid, items: valid.items.slice(0, 2) });
    expect(result.items).toHaveLength(2);
  });

  it('biri başarısız olursa o öğe failed döner, diğerlerinin sonucu ve maliyeti korunur', async () => {
    const { service } = setup({
      evaluate: (i) =>
        Promise.resolve(i.textId === 101 ? failed(i.textId) : succeeded(i.textId, 80, 0.002)),
    });
    const result = await service.compare(valid);
    expect(result.items.map((i) => i.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    expect(result.items[1]).toMatchObject({ error: 'hakem geçersiz cevap verdi' });
    expect(result.items[1]).not.toHaveProperty('totalScore');
    expect(result.totalCostUsd).toBeCloseTo(0.004);
  });

  it('fiyat bilinmiyorsa toplam maliyet boştur (sıfır sanılmaz)', async () => {
    const { service } = setup({ evaluate: (i) => Promise.resolve(succeeded(i.textId, 80, null)) });
    expect((await service.compare(valid)).totalCostUsd).toBeNull();
  });

  it('beklenmeyen hata olursa diğer puanlamalar bitince hata fırlatılır', async () => {
    const { service, evaluate } = setup({
      evaluate: (i) =>
        i.textId === 101
          ? Promise.reject(new Error('veritabanı koptu'))
          : Promise.resolve(succeeded(i.textId, 80, 0.001)),
    });
    await expect(service.compare(valid)).rejects.toThrow('veritabanı koptu');
    expect(evaluate).toHaveBeenCalledTimes(3);
  });
});

describe('karşılaştırma servisi: doğrulama (kayıt açılmaz, hakem çağrılmaz)', () => {
  const bad: [string, unknown][] = [
    ['tek metin', { ...valid, items: [item('a')] }],
    ['dört metin', { ...valid, items: [item('a'), item('b'), item('c'), item('d')] }],
    ['boş metin', { ...valid, items: [item('a'), item('   ')] }],
    ['20001 karakterlik metin', { ...valid, items: [item('a'), item('x'.repeat(20_001))] }],
    ['bilinmeyen tür', { ...valid, genre: 'şiir' }],
    ['boş tema', { ...valid, theme: '  ' }],
    ['33 karakterlik tema', { ...valid, theme: 'x'.repeat(33) }],
    ['fazladan alan', { ...valid, judgeModelId: 1 }],
    ['metin öğesinde fazladan alan', { ...valid, items: [{ body: 'a', author: 'x' }, item('b')] }],
    ['gövde yok', null],
  ];

  it.each(bad)('%s reddedilir', async (_name, body) => {
    const { service, texts, evaluate, models } = setup();
    await expect(service.compare(body)).rejects.toMatchObject({ name: 'ZodError' });
    expect(texts.createManual).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(models.findByModelIds).not.toHaveBeenCalled();
  });

  it('20000 karakterlik metin kabul edilir (sınır dahil)', async () => {
    const { service } = setup();
    await expect(
      service.compare({ ...valid, items: [item('x'.repeat(20_000)), item('b')] }),
    ).resolves.toBeDefined();
  });
});

describe('karşılaştırma servisi: ön koşullar (para harcanmadan, kayıt açılmadan)', () => {
  const expectNothingSpent = (s: ReturnType<typeof setup>) => {
    expect(s.texts.createManual).not.toHaveBeenCalled();
    expect(s.evaluate).not.toHaveBeenCalled();
  };

  it.each([
    ['kayıtlı değil', []],
    ['kapalı', [{ ...judge, active: false }]],
    ['birden çok sağlayıcıda var', [judge, { ...judge, id: 8, provider: 'openai' as const }]],
    ['adı benzer ama farklı', [{ ...judge, modelId: 'deepseek-flash-2' }]],
  ])('hakem model %s: 503', async (_name, models) => {
    const s = setup({ models });
    await expect(s.service.compare(valid)).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expectNothingSpent(s);
  });

  it('sağlayıcı anahtarı tanımlı değilse 503', async () => {
    const s = setup({
      providers: () => {
        throw AppError.unavailable(
          'deepseek sağlayıcısı kullanılamıyor: API anahtarı tanımlı değil',
        );
      },
    });
    await expect(s.service.compare(valid)).rejects.toMatchObject({ status: 503 });
    expectNothingSpent(s);
  });

  it('etkin rubrik yoksa 404 ve kayıt açılmaz', async () => {
    const s = setup({
      rubrics: () => Promise.reject(AppError.notFound('Etkin rubrik yok: siir')),
    });
    await expect(s.service.compare(valid)).rejects.toMatchObject({ status: 404 });
    expectNothingSpent(s);
  });

  it('rubrik istenen türe göre okunur', async () => {
    const s = setup();
    await s.service.compare({ ...valid, genre: 'hikaye' });
    expect(s.getActiveRubric).toHaveBeenCalledWith('hikaye');
  });
});
