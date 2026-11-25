import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../src/domain/analysis.js';
import { createDb } from '../src/lib/prisma.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import type { GenerateRequest } from '../src/providers/provider.js';
import { createProviderRegistry } from '../src/providers/registry.js';
import { PrismaEvaluationRepository } from '../src/repositories/prisma-evaluation.repository.js';
import { PrismaExportRepository } from '../src/repositories/prisma-export.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { PrismaTextRepository } from '../src/repositories/prisma-text.repository.js';
import {
  createComparisonService,
  type ComparisonService,
} from '../src/services/comparison.service.js';
import { createEvaluationService } from '../src/services/evaluation.service.js';
import { createPromptTemplateService } from '../src/services/prompt-template.service.js';
import { createRubricService } from '../src/services/rubric.service.js';
import { cleanRubricData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

const seedDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/seed-data');
const judgeTemplate = JSON.parse(readFileSync(resolve(seedDir, 'prompts/judge-v1.json'), 'utf8'));

const levels = [
  { score: 1, descriptor: 'en düşük' },
  { score: 5, descriptor: 'en yüksek' },
];
const rubricInput = {
  genre: 'siir',
  version: '0.1-test',
  scale: { min: 1, max: 5 },
  criteria: [
    { key: 'imge', label: 'İmge', description: 'imge gücü', weight: 0.5, levels },
    { key: 'ritim', label: 'Ritim', description: 'ahenk', weight: 0.3, levels },
    { key: 'ozgun', label: 'Özgünlük', description: 'özgünlük', weight: 0.2, levels },
  ],
};
// 0,5·100 + 0,3·50 + 0,2·0 = 65
const good = JSON.stringify({
  puanlar: {
    imge: { puan: 5, gerekce: 'imge gerekçesi' },
    ritim: { puan: 3, gerekce: 'ritim gerekçesi' },
    ozgun: { puan: 1, gerekce: 'özgünlük gerekçesi' },
  },
});

const items = [
  { label: 'ChatGPT', body: 'Yaprak yaprak döküldü gün.' },
  { label: 'Claude', body: 'Bir ses kaldı rüzgârda.' },
  { label: 'Gemini', body: 'Deniz uyur, dalga uyanık.' },
];
const request = (over: Record<string, unknown> = {}) => ({
  genre: 'siir',
  theme: 'Doğa',
  items,
  ...over,
});

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  const cleanAll = () => cleanRubricData(db);
  afterAll(async () => {
    await cleanAll();
    await db.$disconnect();
  });

  describe('MySQL: karşılaştırma (üç metin, sabit hakem)', () => {
    let mock: MockProvider;
    let service: ComparisonService;

    function build(
      respond: (r: GenerateRequest) => string = () => good,
      judgeModel = 'mock-judge',
    ) {
      mock = new MockProvider({ respond });
      const rubrics = createRubricService(new PrismaRubricRepository(db));
      const models = new PrismaProviderModelRepository(db);
      const providers = createProviderRegistry({ mock });
      service = createComparisonService({
        texts: new PrismaTextRepository(db),
        models,
        providers,
        rubrics,
        judgeModel,
        evaluation: createEvaluationService({
          evaluations: new PrismaEvaluationRepository(db),
          models,
          templates: createPromptTemplateService(new PrismaPromptTemplateRepository(db)),
          rubrics,
          providers,
          resilience: { sleep: async () => {} },
        }),
      });
    }

    beforeEach(async () => {
      await cleanAll();
      const rubrics = createRubricService(new PrismaRubricRepository(db));
      await rubrics.activateRubric((await rubrics.importRubric(rubricInput)).id);
      await createPromptTemplateService(new PrismaPromptTemplateRepository(db)).createTemplate(
        judgeTemplate,
      );
      await db.providerModel.create({
        data: {
          provider: 'mock',
          modelId: 'mock-judge',
          displayName: 'Mock Hakem',
          active: true,
          defaultParams: { maxTokens: 500, priceUsdPerMillion: { input: 1, output: 2 } },
        },
      });
      build();
    });

    it('metinleri elle girilen olarak etiketiyle kaydeder, her birini puanlar, sonucu sırayla döner', async () => {
      const result = await service.compare(request());

      const texts = await db.text.findMany({ orderBy: { id: 'asc' } });
      expect(texts.map((t) => [t.source, t.label, t.genre, t.theme, t.generationId])).toEqual([
        ['manual', 'ChatGPT', 'siir', 'Doğa', null],
        ['manual', 'Claude', 'siir', 'Doğa', null],
        ['manual', 'Gemini', 'siir', 'Doğa', null],
      ]);
      expect(texts[1]!.body).toBe('Bir ses kaldı rüzgârda.');

      expect(result.judge).toBe('mock/mock-judge');
      expect(result.rubric.version).toBe('0.1-test');
      expect(result.rubric.criteria.map((c) => c.label)).toEqual(['İmge', 'Ritim', 'Özgünlük']);
      expect(result.items.map((i) => [i.label, i.textId])).toEqual(
        texts.map((t) => [t.label, t.id]),
      );
      for (const item of result.items) {
        expect(item.status).toBe('succeeded');
        if (item.status !== 'succeeded') return;
        expect(item.totalScore).toBeCloseTo(65, 10);
        expect(item.scores.map((s) => s.score)).toEqual([5, 3, 1]);
      }
      expect(result.totalCostUsd).toBeGreaterThan(0);

      const evaluations = await db.evaluation.findMany({ include: { scores: true } });
      expect(evaluations).toHaveLength(3);
      expect(evaluations.every((e) => e.status === 'succeeded' && e.scores.length === 3)).toBe(
        true,
      );
      expect(new Set(evaluations.map((e) => e.evaluatorRef))).toEqual(new Set(['mock/mock-judge']));
    });

    it('hakem kördür: gönderilen komutta etiket ve model adı yoktur, metin vardır', async () => {
      await service.compare(request());
      expect(mock.calls).toHaveLength(3);
      const sent = mock.calls.map((c) => c.prompt).join('\n');
      expect(sent).toContain('Bir ses kaldı rüzgârda.');
      for (const secret of ['ChatGPT', 'Claude', 'Gemini']) expect(sent).not.toContain(secret);
    });

    it('elle girilen metinler model analizine girmez (yazarı yoktur), "elle girilen" sayılır', async () => {
      await service.compare(request());
      const [condition] = analyze(await new PrismaExportRepository(db).listEvaluations());
      expect(condition).toMatchObject({ texts: 3, manualTexts: 3, unmeasuredTexts: 0 });
      expect(condition!.breakdowns[0]!.groups).toEqual([]);
    });

    it('biri başarısız olursa diğerleri kaydedilir; başarısızın puanı yazılmaz', async () => {
      build((r) => (r.prompt.includes('Bir ses kaldı') ? 'bu bir JSON değil' : good));
      const result = await service.compare(request());

      expect(result.items.map((i) => i.status)).toEqual(['succeeded', 'failed', 'succeeded']);
      const bad = result.items[1]!;
      expect(bad.status === 'failed' && bad.error).toBeTruthy();

      const rows = await db.evaluation.findMany({
        orderBy: { id: 'asc' },
        include: { scores: true },
      });
      expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'succeeded', 'succeeded']);
      expect(rows.find((r) => r.status === 'failed')!.scores).toEqual([]);
      expect(rows.find((r) => r.status === 'failed')!.totalScore).toBeNull();
    });

    it('kayıt hatasında hiçbir metin kalmaz (tek işlem)', async () => {
      const texts = new PrismaTextRepository(db);
      await expect(
        texts.createManual([
          { genre: 'siir', theme: 'Doğa', body: 'bir', label: null },
          { genre: 'siir', theme: 'Doğa', body: 'iki', label: null },
          { genre: 'yok' as never, theme: 'Doğa', body: 'üç', label: null },
        ]),
      ).rejects.toThrow();
      expect(await db.text.count()).toBe(0);
    });

    it('etkin rubriği olmayan türde metin kaydedilmez, hakem çağrılmaz', async () => {
      await expect(service.compare(request({ genre: 'hikaye' }))).rejects.toMatchObject({
        status: 404,
      });
      expect(await db.text.count()).toBe(0);
      expect(mock.calls).toHaveLength(0);
    });

    it('hakem model kayıtlı değilse metin kaydedilmez, hakem çağrılmaz', async () => {
      build(() => good, 'olmayan-hakem');
      await expect(service.compare(request())).rejects.toMatchObject({ status: 503 });
      expect(await db.text.count()).toBe(0);
      expect(mock.calls).toHaveLength(0);
    });
  });
}
