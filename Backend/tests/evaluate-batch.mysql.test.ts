import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { createDb } from '../src/lib/prisma.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ProviderError, type GenerateRequest } from '../src/providers/provider.js';
import type { ProviderRegistry } from '../src/providers/registry.js';
import { PrismaEvaluationRepository } from '../src/repositories/prisma-evaluation.repository.js';
import { PrismaJobRepository } from '../src/repositories/prisma-job.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import {
  EVALUATE_BATCH,
  createEvaluateBatchHandler,
  enqueueEvaluateBatch,
} from '../src/services/evaluate-batch.js';
import { createEvaluationService } from '../src/services/evaluation.service.js';
import { createJobRunner, type JobRunner } from '../src/services/job-runner.js';
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
const rubricFor = (genre: string, version = '0.1-test') => ({
  genre,
  version,
  scale: { min: 1, max: 5 },
  criteria: [
    { key: 'imge', label: 'İmge', description: 'imge gücü', weight: 0.5, levels },
    { key: 'ritim', label: 'Ritim', description: 'ahenk', weight: 0.3, levels },
    { key: 'ozgun', label: 'Özgünlük', description: 'özgünlük', weight: 0.2, levels },
  ],
});
const good = JSON.stringify({
  puanlar: {
    imge: { puan: 5, gerekce: 'a' },
    ritim: { puan: 3, gerekce: 'b' },
    ozgun: { puan: 1, gerekce: 'c' },
  },
});
const params = { maxTokens: 500, priceUsdPerMillion: { input: 1, output: 2 } };

type Responder = (req: GenerateRequest) => string | Promise<string>;
type ProviderName = 'anthropic' | 'google' | 'openai';

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  const evaluationsRepo = new PrismaEvaluationRepository(db);
  const modelsRepo = new PrismaProviderModelRepository(db);
  const jobs = new PrismaJobRepository(db);
  const templates = createPromptTemplateService(new PrismaPromptTemplateRepository(db));
  const rubrics: RubricService = createRubricService(new PrismaRubricRepository(db));
  const clean = async () => {
    await db.job.deleteMany();
    await cleanRubricData(db);
  };
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  function build(responders: Partial<Record<ProviderName, Responder>> = {}) {
    const mocks = {
      anthropic: new MockProvider({ respond: responders.anthropic ?? (() => good) }),
      google: new MockProvider({ respond: responders.google ?? (() => good) }),
      openai: new MockProvider({ respond: responders.openai ?? (() => good) }),
    };
    const providers: ProviderRegistry = {
      get(id) {
        const found = (mocks as Record<string, MockProvider>)[id];
        if (!found) throw AppError.unavailable(`${id} sağlayıcısı kullanılamıyor`);
        return found;
      },
    };
    const evaluation = createEvaluationService({
      evaluations: evaluationsRepo,
      models: modelsRepo,
      templates,
      rubrics,
      providers,
      resilience: { sleep: async () => {} },
    });
    const handler = createEvaluateBatchHandler({
      evaluation,
      evaluations: evaluationsRepo,
      models: modelsRepo,
      templates,
      rubrics,
      providers,
    });
    const runner: JobRunner = createJobRunner({
      jobs,
      handlers: { [EVALUATE_BATCH]: handler },
      pollMs: 5,
    });
    return { mocks, providers, evaluation, runner };
  }

  describe('MySQL: toplu puanlama işi (evaluate_batch)', () => {
    let ids: { a: number; g: number; o: number };
    let texts: { a: number; g: number; o: number; manual: number };
    let rubricIds: { siir: number; hikaye: number };
    let generateTemplateId: number; // üretim kayıtları (metnin yazarı) için

    const enqueueDeps = () => ({
      jobs,
      evaluations: evaluationsRepo,
      models: modelsRepo,
      templates,
      rubrics,
    });
    const rawJob = (over: Record<string, unknown> = {}) => ({
      textIds: [texts.a, texts.g, texts.o, texts.manual],
      judgeModelIds: [ids.a, ids.g, ids.o],
      ...over,
    });
    const addModel = (provider: string, modelId: string) =>
      db.providerModel.create({
        data: { provider, modelId, displayName: modelId, active: true, defaultParams: params },
      });
    /** Metni, verilen modelin ürettiği metin olarak kaydeder (üretim kaydı → model bağıyla). */
    async function textBy(
      authorModelId: number | null,
      body: string,
      genre: 'siir' | 'hikaye' | 'deneme' = 'siir',
    ) {
      const generationId =
        authorModelId === null
          ? undefined
          : (
              await db.generation.create({
                data: {
                  providerModelId: authorModelId,
                  promptTemplateId: generateTemplateId,
                  genre,
                  theme: 'Sonbahar',
                  params: {},
                  status: 'succeeded',
                },
              })
            ).id;
      return (
        await db.text.create({
          data: {
            genre,
            theme: 'Sonbahar',
            body,
            source: authorModelId === null ? 'manual' : 'generated',
            ...(generationId !== undefined && { generationId }),
          },
        })
      ).id;
    }

    beforeEach(async () => {
      await clean();
      await templates.createTemplate(judgeTemplate);
      generateTemplateId = (
        await templates.createTemplate({
          kind: 'generate',
          version: 'v1',
          body: 'Tür: {{tur}}\nTema: {{tema}}\nUzunluk: {{uzunluk}}',
        })
      ).id;
      const siir = await rubrics.importRubric(rubricFor('siir'));
      const hikaye = await rubrics.importRubric(rubricFor('hikaye'));
      await rubrics.activateRubric(siir.id);
      await rubrics.activateRubric(hikaye.id);
      rubricIds = { siir: siir.id, hikaye: hikaye.id };
      ids = {
        a: (await addModel('anthropic', 'claude-sonnet-5-5')).id,
        g: (await addModel('google', 'gemini-4-hydrogen')).id,
        o: (await addModel('openai', 'gpt-6.2-sol')).id,
      };
      texts = {
        a: await textBy(ids.a, "Claude'un yazdığı şiir."),
        g: await textBy(ids.g, "Gemini'nin yazdığı şiir."),
        o: await textBy(ids.o, "GPT'nin yazdığı şiir."),
        manual: await textBy(null, 'Elle girilen şiir.'),
      };
    });

    describe('iş ekleme', () => {
      it('hakem komutunu ve her türün etkin rubriğini işe sabitler, toplam öğe sayısını hesaplar (varsayılan: hepsi puanlar)', async () => {
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        const templateId = (await templates.getLatest('judge')).id;
        expect(job).toMatchObject({ type: EVALUATE_BATCH, status: 'pending', total: 12 }); // 4 metin × 3 hakem
        expect(job.payload).toMatchObject({
          templateId,
          excludeSelf: false,
          replicates: 1,
          rubrics: [{ genre: 'siir', rubricId: rubricIds.siir }],
        });
        const two = await enqueueEvaluateBatch(enqueueDeps(), rawJob({ replicates: 2 }));
        expect(two.total).toBe(24);
      });

      it('kendini dışlama açıksa toplam, metni yazan ailenin hakemi çıkarılarak hesaplanır; elle girilen metin dışlanmaz', async () => {
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob({ excludeSelf: true }));
        expect(job.total).toBe(9); // 3 üretilmiş metin × 2 + elle girilen 3
      });

      it('geçersiz işi reddeder, kuyruğa hiçbir şey yazılmaz', async () => {
        for (const bad of [
          rawJob({ textIds: [] }),
          rawJob({ textIds: [texts.a, texts.a] }),
          rawJob({ textIds: [999_999] }),
          rawJob({ judgeModelIds: [] }),
          rawJob({ judgeModelIds: [ids.a, ids.a] }),
          rawJob({ judgeModelIds: [999_999] }),
          rawJob({ replicates: 0 }),
          rawJob({ replicates: 11 }),
          rawJob({ maxCostUsd: 0 }),
          rawJob({ yazimHatasi: 1 }),
        ]) {
          await expect(
            enqueueEvaluateBatch(enqueueDeps(), bad),
            JSON.stringify(bad),
          ).rejects.toThrow();
        }
        expect(await db.job.count()).toBe(0);
      });

      it('türü için etkin rubrik yoksa ya da hakem şablonu yoksa reddeder, kuyruğa bir şey yazılmaz', async () => {
        const hikayeText = await textBy(ids.a, 'bir hikâye', 'hikaye');
        await db.rubric.update({ where: { id: rubricIds.hikaye }, data: { status: 'archived' } });
        await expect(
          enqueueEvaluateBatch(enqueueDeps(), rawJob({ textIds: [hikayeText] })),
        ).rejects.toMatchObject({ status: 404 });

        await db.promptTemplate.deleteMany({ where: { kind: 'judge' } });
        await expect(enqueueEvaluateBatch(enqueueDeps(), rawJob())).rejects.toMatchObject({
          status: 404,
        });
        expect(await db.job.count()).toBe(0);
      });
    });

    describe('çalıştırma', () => {
      it('tüm öğeleri puanlar ve kaydeder: kendi metnini puanlayanlar dahil (varsayılan), ilerleme ve sonuç yazılır', async () => {
        const { runner } = build();
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await runner.runUntilIdle();

        expect(await jobs.findById(job.id)).toMatchObject({
          status: 'succeeded',
          total: 12,
          done: 12,
          failed: 0,
          result: { done: 12, failed: 0 },
        });
        expect(await db.evaluation.count({ where: { status: 'succeeded' } })).toBe(12);
        expect(await db.evaluationScore.count()).toBe(36); // 12 × 3 kriter
        // Claude'un metnini Claude hakem de puanladı (kendi puanı, analizde işaretlenecek).
        expect(
          await db.evaluation.count({
            where: { textId: texts.a, evaluatorRef: 'anthropic/claude-sonnet-5-5' },
          }),
        ).toBe(1);
      });

      it('kendini dışlama açıkken hiçbir hakem kendi ailesinin metnini puanlamaz; elle girilen metni hepsi puanlar', async () => {
        const { runner } = build();
        await enqueueEvaluateBatch(enqueueDeps(), rawJob({ excludeSelf: true }));
        await runner.runUntilIdle();

        expect(await db.evaluation.count({ where: { status: 'succeeded' } })).toBe(9);
        const own: [number, string][] = [
          [texts.a, 'anthropic/claude-sonnet-5-5'],
          [texts.g, 'google/gemini-4-hydrogen'],
          [texts.o, 'openai/gpt-6.2-sol'],
        ];
        for (const [textId, evaluatorRef] of own) {
          expect(await db.evaluation.count({ where: { textId, evaluatorRef } }), evaluatorRef).toBe(
            0,
          );
        }
        expect(await db.evaluation.count({ where: { textId: texts.manual } })).toBe(3);
      });

      it('tekrar sayısı kadar kayıt açar, her biri kendi numarasıyla', async () => {
        const { runner } = build();
        await enqueueEvaluateBatch(
          enqueueDeps(),
          rawJob({ replicates: 3, textIds: [texts.manual] }),
        );
        await runner.runUntilIdle();
        const rows = await db.evaluation.findMany({
          where: { evaluatorRef: 'openai/gpt-6.2-sol' },
          orderBy: { replicateNo: 'asc' },
        });
        expect(rows.map((r) => r.replicateNo)).toEqual([1, 2, 3]);
      });

      it('T19: hakem komutlarında metni yazan modelin adı ve sağlayıcısı geçmez', async () => {
        const { runner, mocks } = build();
        await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await runner.runUntilIdle();
        const prompts = Object.values(mocks).flatMap((m) =>
          m.calls.map((c) => c.prompt.toLowerCase()),
        );
        expect(prompts).toHaveLength(12);
        for (const prompt of prompts) {
          for (const name of ['sonnet', 'hydrogen', 'anthropic', 'openai', 'google']) {
            expect(prompt, name).not.toContain(name);
          }
        }
      });

      it('sağlayıcılar paralel şeritlerde çalışır, her sağlayıcıya aynı anda tek istek gider', async () => {
        const events: string[] = [];
        const inFlight = { anthropic: 0, google: 0, openai: 0 };
        let maxInFlight = 0;
        const lane = (name: ProviderName, delay: number): Responder => {
          let n = 0;
          return async () => {
            inFlight[name]++;
            maxInFlight = Math.max(maxInFlight, inFlight[name]);
            await new Promise((r) => setTimeout(r, delay));
            inFlight[name]--;
            events.push(`${name}#${++n}`);
            return good;
          };
        };
        const { runner } = build({
          google: lane('google', 60),
          anthropic: lane('anthropic', 3),
          openai: lane('openai', 3),
        });
        await enqueueEvaluateBatch(enqueueDeps(), rawJob({ judgeModelIds: [ids.g, ids.a, ids.o] }));
        await runner.runUntilIdle();

        expect(maxInFlight).toBe(1);
        expect(events.indexOf('anthropic#4')).toBeLessThan(events.indexOf('google#3'));
        expect(events.indexOf('openai#4')).toBeLessThan(events.indexOf('google#3'));
        expect(await db.evaluation.count({ where: { status: 'succeeded' } })).toBe(12);
      });

      it('bir hakemin hatası işi durdurmaz: o şeridin öğeleri failed sayılır, diğerleri sürer', async () => {
        const { runner } = build({
          google: () => {
            throw new ProviderError('auth', 'anahtar geçersiz');
          },
        });
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await runner.runUntilIdle();

        expect(await jobs.findById(job.id)).toMatchObject({
          status: 'succeeded',
          done: 8,
          failed: 4,
        });
        const failed = await db.evaluation.findMany({ where: { status: 'failed' } });
        expect(failed).toHaveLength(4);
        expect(
          failed.every((r) => r.evaluatorRef.startsWith('google/') && r.error?.includes('auth')),
        ).toBe(true);
        expect(await db.evaluationScore.count()).toBe(24); // başarısızlar için puan satırı yok
      });

      it('bozuk hakem cevabı bir kez yeniden denenir, yine bozuksa o öğe failed olur ve puan yazılmaz', async () => {
        const { runner } = build({ openai: () => 'bozuk cevap' });
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await runner.runUntilIdle();
        expect(await jobs.findById(job.id)).toMatchObject({
          status: 'succeeded',
          done: 8,
          failed: 4,
        });
        const rows = await db.evaluation.findMany({
          where: { evaluatorRef: { startsWith: 'openai/' } },
        });
        expect(rows.every((r) => r.status === 'failed' && r.totalScore === null)).toBe(true);
      });

      it('beklenmeyen (sağlayıcı dışı) hata işi failed yapar ve nedenini yazar; takılı kayıt kalmaz', async () => {
        const { runner } = build({
          openai: () => {
            throw new TypeError('kod hatası');
          },
        });
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await runner.runUntilIdle();
        const stored = await jobs.findById(job.id);
        expect(stored?.status).toBe('failed');
        expect(stored?.error).toContain('kod hatası');
        expect(await db.evaluation.count({ where: { status: 'running' } })).toBe(0);
      });

      it('çalışırken ilerleme veritabanında görünür (tek şeritte her öğeden sonra)', async () => {
        let jobId = 0;
        const seen: number[] = [];
        const { runner } = build({
          anthropic: async () => {
            seen.push((await jobs.findById(jobId))?.done ?? -1);
            return good;
          },
        });
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob({ judgeModelIds: [ids.a] }));
        jobId = job.id;
        await runner.runUntilIdle();
        expect(seen).toEqual([0, 1, 2, 3]);
      });
    });

    describe('yeniden başlatma, bütçe ve korumalar', () => {
      it('T37: kapatılıp açılınca kalan öğelerden devam eder, hiçbir öğe iki kez puanlanmaz', async () => {
        let calls = 0;
        const holder: { runner?: JobRunner } = {};
        const stopAfterFive: Responder = () => {
          if (++calls === 5) void holder.runner?.stop();
          return good;
        };
        const first = build({
          anthropic: stopAfterFive,
          google: stopAfterFive,
          openai: stopAfterFive,
        });
        holder.runner = first.runner;
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await first.runner.runNext();

        const mid = await jobs.findById(job.id);
        expect(mid?.status).toBe('pending');
        expect(mid!.done).toBeGreaterThanOrEqual(5);
        expect(mid!.done).toBeLessThan(12);

        await build().runner.runUntilIdle();
        expect(await jobs.findById(job.id)).toMatchObject({ status: 'succeeded', done: 12 });
        const rows = await db.evaluation.findMany({ where: { status: 'succeeded' } });
        expect(rows).toHaveLength(12);
        expect(
          new Set(rows.map((r) => `${r.textId}|${r.evaluatorRef}|${r.replicateNo}`)).size,
        ).toBe(12);
      });

      it('çökme sonrası "çalışıyor" kalan puanlama kaydı failed yapılır, öğe yeni kayıtla yeniden puanlanır', async () => {
        const job = await enqueueEvaluateBatch(
          enqueueDeps(),
          rawJob({ textIds: [texts.manual], judgeModelIds: [ids.a] }),
        );
        await jobs.claimNext(); // çöküş: iş sahiplenildi, puanlama başladı ama bitmedi
        const stale = await evaluationsRepo.start({
          textId: texts.manual,
          rubricId: rubricIds.siir,
          promptTemplateId: (await templates.getLatest('judge')).id,
          evaluatorRef: 'anthropic/claude-sonnet-5-5',
          replicateNo: 1,
        });

        const { runner } = build();
        await runner.recover();
        await runner.runUntilIdle();

        expect((await db.evaluation.findUniqueOrThrow({ where: { id: stale } })).error).toContain(
          'yarım kaldı',
        );
        expect(await db.evaluation.count({ where: { status: 'succeeded' } })).toBe(1);
        expect(await db.evaluation.count({ where: { status: 'running' } })).toBe(0);
        expect((await jobs.findById(job.id))?.status).toBe('succeeded');
      });

      it('bütçe dolunca iş durur ve nedenini yazar; yeni iş kalan öğeleri tamamlar, biteni atlar', async () => {
        await db.providerModel.updateMany({
          data: {
            defaultParams: { maxTokens: 500, priceUsdPerMillion: { input: 1e6, output: 1e6 } },
          },
        });
        const { runner } = build();
        const small = await enqueueEvaluateBatch(enqueueDeps(), rawJob({ maxCostUsd: 1000 }));
        await runner.runUntilIdle();

        const stopped = await jobs.findById(small.id);
        expect(stopped?.status).toBe('failed');
        expect(stopped?.error).toContain('Bütçe');
        const made = await db.evaluation.count({ where: { status: 'succeeded' } });
        expect(made).toBeGreaterThanOrEqual(1);
        expect(made).toBeLessThan(12);

        const rest = await enqueueEvaluateBatch(enqueueDeps(), rawJob({ maxCostUsd: 1e9 }));
        await runner.runUntilIdle();
        expect(await jobs.findById(rest.id)).toMatchObject({ status: 'succeeded', done: 12 });
        expect(await db.evaluation.count({ where: { status: 'succeeded' } })).toBe(12);
      });

      it('fiyatı bilinmeyen hakem varken bütçe verilirse iş çağrı yapılmadan failed olur', async () => {
        await db.providerModel.update({ where: { id: ids.g }, data: { defaultParams: {} } });
        const { runner, mocks } = build();
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob({ maxCostUsd: 5 }));
        await runner.runUntilIdle();
        expect((await jobs.findById(job.id))?.error).toContain('Fiyat bilgisi olmayan');
        expect(await db.evaluation.count()).toBe(0);
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
      });

      it('hakem şablonu iş eklendikten sonra değişmişse iş failed olur, hiçbir çağrı yapılmaz', async () => {
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await templates.createTemplate({ ...judgeTemplate, version: 'v2' });
        const { runner, mocks } = build();
        await runner.runUntilIdle();
        const stored = await jobs.findById(job.id);
        expect(stored?.status).toBe('failed');
        expect(stored?.error).toContain('şablon');
        expect(await db.evaluation.count()).toBe(0);
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
      });

      it('etkin rubrik iş eklendikten sonra değişmişse iş failed olur, hiçbir çağrı yapılmaz', async () => {
        const job = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        const next = await rubrics.importRubric(rubricFor('siir', '0.2-test'));
        await rubrics.activateRubric(next.id);
        const { runner, mocks } = build();
        await runner.runUntilIdle();
        const stored = await jobs.findById(job.id);
        expect(stored?.status).toBe('failed');
        expect(stored?.error).toContain('rubrik');
        expect(await db.evaluation.count()).toBe(0);
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
      });

      it('T21: yeni rubrik etkinleşince aynı metinler yeni rubrikle yeniden puanlanır, eski puanlara dokunulmaz', async () => {
        const { runner } = build();
        const first = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await runner.runUntilIdle();
        expect((await jobs.findById(first.id))?.status).toBe('succeeded');
        expect(await db.evaluation.count({ where: { rubricId: rubricIds.siir } })).toBe(12);

        const next = await rubrics.importRubric(rubricFor('siir', '0.2-test'));
        await rubrics.activateRubric(next.id);
        const second = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        expect(second.payload).toMatchObject({ rubrics: [{ genre: 'siir', rubricId: next.id }] });
        expect(second.total).toBe(12); // biten öğeler atlanmaz: puanlar eski rubrikle alınmıştı
        await runner.runUntilIdle();
        expect((await jobs.findById(second.id))?.status).toBe('succeeded');
        expect(
          await db.evaluation.count({ where: { rubricId: next.id, status: 'succeeded' } }),
        ).toBe(12);
        expect(await db.evaluation.count({ where: { rubricId: rubricIds.siir } })).toBe(12);
        expect(await db.evaluation.count()).toBe(24);
      });

      it('kapalı hakem, anahtarı olmayan sağlayıcı ya da silinmiş metin: iş çağrı yapılmadan failed olur', async () => {
        const { runner, mocks } = build();
        const closed = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await db.providerModel.update({ where: { id: ids.g }, data: { active: false } }); // ekledikten sonra kapandı
        await runner.runUntilIdle();
        expect((await jobs.findById(closed.id))?.error).toContain(String(ids.g));

        await db.providerModel.update({ where: { id: ids.g }, data: { active: true } });
        await db.providerModel.update({ where: { id: ids.o }, data: { provider: 'mock' } }); // kayıt defterinde yok
        const missing = await enqueueEvaluateBatch(
          enqueueDeps(),
          rawJob({ judgeModelIds: [ids.a, ids.o] }),
        );
        await runner.runUntilIdle();
        expect((await jobs.findById(missing.id))?.error).toContain('kullanılamıyor');

        await db.providerModel.update({ where: { id: ids.o }, data: { provider: 'openai' } });
        const gone = await enqueueEvaluateBatch(enqueueDeps(), rawJob());
        await db.text.delete({ where: { id: texts.manual } });
        await runner.runUntilIdle();
        expect((await jobs.findById(gone.id))?.error).toContain(String(texts.manual));

        expect(await db.evaluation.count()).toBe(0);
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
      });
    });
  });

  describe('MySQL: puanlama servisi ve depo eklentileri (toplu iş için)', () => {
    it('sonuç token sayılarını ve (fiyat biliniyorsa) gerçek maliyeti taşır; başarısızda boştur', async () => {
      await clean();
      await templates.createTemplate(judgeTemplate);
      const rubric = await rubrics.importRubric(rubricFor('siir'));
      await rubrics.activateRubric(rubric.id);
      const model = await db.providerModel.create({
        data: {
          provider: 'anthropic',
          modelId: 'm-a',
          displayName: 'm-a',
          active: true,
          defaultParams: params,
        },
      });
      const text = await db.text.create({
        data: { genre: 'siir', theme: 'Sonbahar', body: 'bir şiir', source: 'manual' },
      });

      const { evaluation } = build();
      const ok = await evaluation.evaluate({ textId: text.id, judgeModelId: model.id });
      if (ok.status !== 'succeeded') throw new Error('başarılı beklendi');
      const row = await db.evaluation.findFirstOrThrow();
      const usage = (row.rawResponse as { usage: { inputTokens: number; outputTokens: number } })
        .usage;
      expect(ok.inputTokens).toBe(usage.inputTokens);
      expect(ok.outputTokens).toBe(usage.outputTokens);
      expect(ok.costUsd).toBeCloseTo((usage.inputTokens * 1 + usage.outputTokens * 2) / 1e6, 12);

      await db.providerModel.update({ where: { id: model.id }, data: { defaultParams: {} } });
      const unpriced = await evaluation.evaluate({
        textId: text.id,
        judgeModelId: model.id,
        replicateNo: 2,
      });
      expect(unpriced).toMatchObject({ status: 'succeeded', costUsd: null });

      const failing = build({ anthropic: () => 'bozuk' });
      const failed = await failing.evaluation.evaluate({
        textId: text.id,
        judgeModelId: model.id,
        replicateNo: 3,
      });
      expect(failed).toMatchObject({
        status: 'failed',
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      });
    });

    it('depo: başarılıları (şablon, rubrik ve hakeme göre) listeler, yarım kalanı failed yapar, yazar bilgisini verir', async () => {
      await clean();
      const template = await templates.createTemplate(judgeTemplate);
      const rubric = await rubrics.importRubric(rubricFor('siir'));
      await rubrics.activateRubric(rubric.id);
      const author = await db.providerModel.create({
        data: { provider: 'google', modelId: 'g-1', displayName: 'g', active: true },
      });
      const generation = await db.generation.create({
        data: {
          providerModelId: author.id,
          promptTemplateId: template.id,
          genre: 'siir',
          theme: 'Sonbahar',
          params: {},
          status: 'succeeded',
        },
      });
      const generated = await db.text.create({
        data: {
          genre: 'siir',
          theme: 'Sonbahar',
          body: 'üretilmiş',
          source: 'generated',
          generationId: generation.id,
        },
      });
      const manual = await db.text.create({
        data: { genre: 'siir', theme: 'Sonbahar', body: 'elle', source: 'manual' },
      });
      const start = (textId: number, replicateNo: number) =>
        evaluationsRepo.start({
          textId,
          rubricId: rubric.id,
          promptTemplateId: template.id,
          evaluatorRef: 'x/y',
          replicateNo,
        });
      const done = await start(generated.id, 1);
      await evaluationsRepo.succeed(done, { totalScore: 50, scores: [], rawResponse: {} });
      await start(manual.id, 1); // yarım kalan

      const filter = {
        promptTemplateId: template.id,
        rubricIds: [rubric.id],
        textIds: [generated.id, manual.id],
      };
      expect(await evaluationsRepo.findSucceeded(filter)).toEqual([
        { textId: generated.id, evaluatorRef: 'x/y', replicateNo: 1 },
      ]);
      expect(
        await evaluationsRepo.findSucceeded({ ...filter, rubricIds: [rubric.id + 999] }),
      ).toEqual([]);
      expect(
        await evaluationsRepo.findSucceeded({ ...filter, promptTemplateId: template.id + 999 }),
      ).toEqual([]);

      expect(await evaluationsRepo.failInterrupted('sunucu kapandı, yarım kaldı')).toBe(1);
      expect(await evaluationsRepo.failInterrupted('x')).toBe(0);

      const authors = await evaluationsRepo.findAuthors([generated.id, manual.id]);
      expect(authors).toEqual([{ textId: generated.id, provider: 'google', modelId: 'g-1' }]); // elle girilenin yazarı yok
      const found = await evaluationsRepo.findTexts([generated.id, manual.id, 999_999]);
      expect(found.map((t) => t.id).sort()).toEqual([generated.id, manual.id].sort());
    });
  });
} else if (process.env.CI) {
  describe('MySQL: toplu puanlama işi', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: toplu puanlama işi (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
