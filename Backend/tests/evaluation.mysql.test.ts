import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { createDb } from '../src/lib/prisma.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import type { GenerateRequest } from '../src/providers/provider.js';
import { createProviderRegistry } from '../src/providers/registry.js';
import { PrismaEvaluationRepository } from '../src/repositories/prisma-evaluation.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import {
  createEvaluationService,
  type EvaluationService,
} from '../src/services/evaluation.service.js';
import { createPromptTemplateService } from '../src/services/prompt-template.service.js';
import { createRubricService, type RubricService } from '../src/services/rubric.service.js';
import { cleanRubricData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

const seedDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/seed-data');
const judgeTemplate = JSON.parse(readFileSync(resolve(seedDir, 'prompts/judge-v1.json'), 'utf8'));

const levels = [
  { score: 1, descriptor: 'en düşük' },
  { score: 5, descriptor: 'en yüksek' },
];
/** Hesabı elle doğrulanabilsin diye küçük rubrik: ağırlıklar 0,5 / 0,3 / 0,2. */
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

const answer = (a: number, b: number, c: number) =>
  JSON.stringify({
    puanlar: {
      imge: { puan: a, gerekce: 'imge gerekçesi' },
      ritim: { puan: b, gerekce: 'ritim gerekçesi' },
      ozgun: { puan: c, gerekce: 'özgünlük gerekçesi' },
    },
  });
const good = answer(5, 3, 1); // 0,5·100 + 0,3·50 + 0,2·0 = 65

const params = { maxTokens: 500, priceUsdPerMillion: { input: 1, output: 2 } };

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  const cleanAll = async () => {
    await cleanRubricData(db);
  };
  afterAll(async () => {
    await cleanAll(); // sonraki test dosyalarının tablolarını temiz bırak
    await db.$disconnect();
  });

  describe('MySQL: değerlendirme (hakem puanı kaydı)', () => {
    let service: EvaluationService;
    let rubrics: RubricService;
    let mock: MockProvider;
    let ids: { judge: number; text: number; rubric: number; template: number };

    /** Servisi, verilen hakem cevabıyla kurar. Bekleme atlanır, testler hızlı kalır. */
    function build(
      respond: (req: GenerateRequest) => string | Promise<string> = () => good,
      registryMock = true,
    ) {
      mock = new MockProvider({ respond });
      service = createEvaluationService({
        evaluations: new PrismaEvaluationRepository(db),
        models: new PrismaProviderModelRepository(db),
        templates: createPromptTemplateService(new PrismaPromptTemplateRepository(db)),
        rubrics,
        providers: createProviderRegistry(registryMock ? { mock } : {}),
        resilience: { sleep: async () => {} },
      });
    }

    const request = (over: Record<string, unknown> = {}) => ({
      textId: ids.text,
      judgeModelId: ids.judge,
      ...over,
    });

    beforeEach(async () => {
      await cleanAll();
      rubrics = createRubricService(new PrismaRubricRepository(db));
      const rubric = await rubrics.importRubric(rubricInput);
      await rubrics.activateRubric(rubric.id);
      const template = await createPromptTemplateService(
        new PrismaPromptTemplateRepository(db),
      ).createTemplate(judgeTemplate);
      const judge = await db.providerModel.create({
        data: {
          provider: 'mock',
          modelId: 'mock-judge',
          displayName: 'Mock Hakem',
          active: true,
          defaultParams: params,
        },
      });
      const text = await db.text.create({
        data: {
          genre: 'siir',
          theme: 'Sonbahar',
          body: 'Yaprak yaprak döküldü gün,\nbir ses kaldı rüzgârda.',
          source: 'manual',
          label: 'elle girilen',
        },
      });
      ids = { judge: judge.id, text: text.id, rubric: rubric.id, template: template.id };
      build();
    });

    it('başarılı puanı kaydeder: değerlendirme, kriter puanları, toplam, komut ve rubrik sürümü', async () => {
      const result = await service.evaluate(request());
      expect(result).toMatchObject({ status: 'succeeded', attempts: 1 });
      if (result.status !== 'succeeded') return;
      expect(result.totalScore).toBeCloseTo(65, 10);

      const row = await db.evaluation.findFirstOrThrow({ include: { scores: true } });
      expect(row).toMatchObject({
        id: result.evaluationId,
        textId: ids.text,
        rubricId: ids.rubric,
        promptTemplateId: ids.template,
        evaluatorType: 'llm',
        evaluatorRef: 'mock/mock-judge',
        replicateNo: 1,
        status: 'succeeded',
        error: null,
      });
      expect(row.totalScore).toBeCloseTo(65, 10);
      const byKey = Object.fromEntries(row.scores.map((s) => [s.criterionKey, s]));
      expect(row.scores).toHaveLength(3);
      expect(byKey.imge).toMatchObject({ score: 5, comment: 'imge gerekçesi' });
      expect(byKey.ritim).toMatchObject({ score: 3, comment: 'ritim gerekçesi' });
      expect(byKey.ozgun).toMatchObject({ score: 1, comment: 'özgünlük gerekçesi' });
    });

    it('tekrarlanabilirlik için ham cevabı, denemeyi, tokenleri, süreyi ve sürümleri saklar', async () => {
      await service.evaluate(request());
      const row = await db.evaluation.findFirstOrThrow();
      expect(row.rawResponse).toMatchObject({
        attempts: 1,
        templateVersion: 'v1',
        rubricVersion: '0.1-test',
        answer: { puanlar: { imge: { puan: 5, gerekce: 'imge gerekçesi' } } },
        usage: {
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          latencyMs: expect.any(Number),
        },
      });
    });

    it('T14: cevap iki kez de bozuksa failed olur, hiçbir puan satırı yazılmaz', async () => {
      build(() => 'bu JSON değil');
      const result = await service.evaluate(request());
      expect(result).toMatchObject({ status: 'failed', attempts: 2 });

      const row = await db.evaluation.findFirstOrThrow();
      expect(row.status).toBe('failed');
      expect(row.error).toContain('invalid_output');
      expect(row.totalScore).toBeNull();
      expect(await db.evaluationScore.count()).toBe(0);
      expect(mock.calls).toHaveLength(2);
    });

    it('ilk cevap bozuk, ikincisi geçerliyse başarılı olur ve iki deneme kaydedilir', async () => {
      let n = 0;
      build(() => (n++ === 0 ? '{"puanlar": {' : good));
      const result = await service.evaluate(request());
      expect(result).toMatchObject({ status: 'succeeded', attempts: 2 });
      expect((await db.evaluation.findFirstOrThrow()).rawResponse).toMatchObject({ attempts: 2 });
    });

    it('hakem çağrısı sürerken kayıt "running" durumundadır (sunucu kapanırsa yarım iş görünür kalır)', async () => {
      let during: string | undefined;
      build(async () => {
        during = (await db.evaluation.findFirstOrThrow()).status;
        return good;
      });
      await service.evaluate(request());
      expect(during).toBe('running');
    });

    it('rubriği "kullanıldı" yapar (ADR 0003): sonra içeriği değiştirilemez, ilk kullanım zamanı korunur', async () => {
      expect((await rubrics.getRubric(ids.rubric)).usedAt).toBeNull();
      await service.evaluate(request());
      const first = (await rubrics.getRubric(ids.rubric)).usedAt;
      expect(first).toBeInstanceOf(Date);

      await service.evaluate(request({ replicateNo: 2 }));
      expect((await rubrics.getRubric(ids.rubric)).usedAt).toEqual(first);

      const error = await appError(rubrics.updateRubric(ids.rubric, rubricInput));
      expect(error.status).toBe(409);
    });

    it('başarısız değerlendirme de rubriği kullanılmış sayar (hakeme o rubrikle soruldu)', async () => {
      build(() => 'bozuk');
      await service.evaluate(request());
      expect((await rubrics.getRubric(ids.rubric)).usedAt).toBeInstanceOf(Date);
    });

    it('tekrar numarasıyla aynı metin ve hakem için ayrı kayıtlar açar', async () => {
      await service.evaluate(request());
      await service.evaluate(request({ replicateNo: 2 }));
      const rows = await db.evaluation.findMany({ orderBy: { replicateNo: 'asc' } });
      expect(rows.map((r) => r.replicateNo)).toEqual([1, 2]);
      expect(await db.evaluationScore.count()).toBe(6);
    });

    it('T19: komuta metni yazan modelin adı, görünen adı ve sağlayıcısı girmez', async () => {
      const author = await db.providerModel.create({
        data: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-5-5',
          displayName: 'Claude Sonnet 5.5',
          active: true,
        },
      });
      const gen = await db.generation.create({
        data: {
          providerModelId: author.id,
          promptTemplateId: ids.template,
          genre: 'siir',
          theme: 'Sonbahar',
          params: {},
          status: 'succeeded',
        },
      });
      const text = await db.text.create({
        data: {
          genre: 'siir',
          theme: 'Sonbahar',
          body: 'Üretilmiş bir şiir.',
          source: 'generated',
          generationId: gen.id,
        },
      });
      await service.evaluate(request({ textId: text.id }));
      const prompt = (mock.calls[0]?.prompt ?? '').toLowerCase();
      for (const name of ['claude', 'sonnet', 'anthropic'])
        expect(prompt, name).not.toContain(name);
      expect(prompt).toContain('üretilmiş bir şiir');
    });

    it('çağrıdan önce doğrular: metin yoksa 404, hakem yoksa ya da kapalıysa 404, hiçbir kayıt açılmaz', async () => {
      expect((await appError(service.evaluate(request({ textId: 999_999 })))).status).toBe(404);
      expect((await appError(service.evaluate(request({ judgeModelId: 999_999 })))).status).toBe(
        404,
      );
      await db.providerModel.update({ where: { id: ids.judge }, data: { active: false } });
      expect((await appError(service.evaluate(request()))).status).toBe(404);

      expect(await db.evaluation.count()).toBe(0);
      expect(mock.calls).toHaveLength(0);
      expect((await rubrics.getRubric(ids.rubric)).usedAt).toBeNull();
    });

    it('sağlayıcı anahtarı yoksa 503 verir, hiçbir kayıt açılmaz ve rubrik kullanılmış sayılmaz', async () => {
      await db.providerModel.update({ where: { id: ids.judge }, data: { provider: 'anthropic' } });
      build(() => good, false);
      expect((await appError(service.evaluate(request()))).status).toBe(503);
      expect(await db.evaluation.count()).toBe(0);
      expect((await rubrics.getRubric(ids.rubric)).usedAt).toBeNull();
    });

    it('yargıç şablonu ya da etkin rubrik yoksa 404 verir, çağrı ve kayıt olmaz', async () => {
      await db.promptTemplate.deleteMany({ where: { kind: 'judge' } });
      expect((await appError(service.evaluate(request()))).status).toBe(404);

      await createPromptTemplateService(new PrismaPromptTemplateRepository(db)).createTemplate(
        judgeTemplate,
      );
      await db.rubric.update({ where: { id: ids.rubric }, data: { status: 'archived' } });
      expect((await appError(service.evaluate(request()))).status).toBe(404);

      expect(await db.evaluation.count()).toBe(0);
      expect(mock.calls).toHaveLength(0);
    });

    it('geçersiz istekleri reddeder', async () => {
      for (const bad of [
        {},
        request({ textId: -1 }),
        request({ judgeModelId: 0 }),
        request({ replicateNo: 0 }),
        request({ yazimHatasi: true }),
        request({ textId: '3' }),
      ]) {
        await expect(service.evaluate(bad), JSON.stringify(bad)).rejects.toThrow();
      }
      expect(await db.evaluation.count()).toBe(0);
    });

    it('beklenmeyen (sağlayıcı dışı) hata takılı kalan kayıt bırakmaz: failed yazılır ve hata yukarı atılır', async () => {
      build(() => {
        throw new TypeError('kod hatası');
      });
      await expect(service.evaluate(request())).rejects.toThrow(TypeError);
      const row = await db.evaluation.findFirstOrThrow();
      expect(row.status).toBe('failed');
      expect(row.error).toContain('beklenmeyen hata');
      expect(await db.evaluationScore.count()).toBe(0);
    });

    it('süre sınırı hakem modelin ayarından gelir (yavaş modeller için)', async () => {
      await db.providerModel.update({
        where: { id: ids.judge },
        data: { defaultParams: { ...params, timeoutMs: 20 } },
      });
      build(() => new Promise<string>(() => {})); // hiç cevap vermez
      const result = await service.evaluate(request());
      expect(result.status).toBe('failed');
      expect((await db.evaluation.findFirstOrThrow()).error).toContain('timeout');
    });
  });
} else if (process.env.CI) {
  describe('MySQL: değerlendirme (hakem puanı kaydı)', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: değerlendirme (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
