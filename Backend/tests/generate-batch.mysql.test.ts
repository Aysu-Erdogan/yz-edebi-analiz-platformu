import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { createDb } from '../src/lib/prisma.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ProviderError, type GenerateRequest } from '../src/providers/provider.js';
import type { ProviderRegistry } from '../src/providers/registry.js';
import { PrismaGenerationRepository } from '../src/repositories/prisma-generation.repository.js';
import { PrismaJobRepository } from '../src/repositories/prisma-job.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import {
  GENERATE_BATCH,
  createGenerateBatchHandler,
  enqueueGenerateBatch,
} from '../src/services/generate-batch.js';
import { createGenerationService } from '../src/services/generation.service.js';
import { createJobRunner, type JobRunner } from '../src/services/job-runner.js';
import {
  createPromptTemplateService,
  type PromptTemplateService,
} from '../src/services/prompt-template.service.js';
import { cleanGenerationData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();
const TEMPLATE_BODY = 'Tür: {{tur}}\nTema: {{tema}}\nUzunluk: {{uzunluk}}';
const params = { maxTokens: 200, priceUsdPerMillion: { input: 1, output: 2 } };

type Responder = (req: GenerateRequest) => string | Promise<string>;
const ok: Responder = (req) => `[${req.model}] metin`;

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  const generationsRepo = new PrismaGenerationRepository(db);
  const modelsRepo = new PrismaProviderModelRepository(db);
  const jobs = new PrismaJobRepository(db);
  const templates: PromptTemplateService = createPromptTemplateService(
    new PrismaPromptTemplateRepository(db),
  );
  const clean = async () => {
    await db.job.deleteMany();
    await cleanGenerationData(db);
  };
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  /** Sağlayıcı başına ayrı sahte sağlayıcı: şerit (lane) davranışı ve hata yalıtımı denenir. */
  function build(responders: Partial<Record<'anthropic' | 'google' | 'openai', Responder>> = {}) {
    const mocks = {
      anthropic: new MockProvider({ respond: responders.anthropic ?? ok }),
      google: new MockProvider({ respond: responders.google ?? ok }),
      openai: new MockProvider({ respond: responders.openai ?? ok }),
    };
    const providers: ProviderRegistry = {
      get(id) {
        const found = (mocks as Record<string, MockProvider>)[id];
        if (!found) throw AppError.unavailable(`${id} sağlayıcısı kullanılamıyor`);
        return found;
      },
    };
    const generation = createGenerationService({
      models: modelsRepo,
      generations: generationsRepo,
      templates,
      providers,
      resilience: { sleep: async () => {} },
    });
    const handler = createGenerateBatchHandler({
      generation,
      generations: generationsRepo,
      models: modelsRepo,
      templates,
      providers,
    });
    const runner: JobRunner = createJobRunner({
      jobs,
      handlers: { [GENERATE_BATCH]: handler },
      pollMs: 5,
    });
    return { mocks, providers, generation, runner };
  }

  describe('MySQL: üretim servisi eklentileri (toplu iş için)', () => {
    let modelId: number;
    beforeEach(async () => {
      await clean();
      await templates.createTemplate({ kind: 'generate', version: 'v1', body: TEMPLATE_BODY });
      modelId = (
        await db.providerModel.create({
          data: {
            provider: 'anthropic',
            modelId: 'm-a',
            displayName: 'm-a',
            active: true,
            defaultParams: params,
          },
        })
      ).id;
    });

    it('firstReplicateNo: tekrar numaraları verilen sayıdan başlar (yeniden başlatmada kalınan yerden)', async () => {
      const { generation } = build();
      const result = await generation.generate({
        genre: 'siir',
        theme: 'Sonbahar',
        modelIds: [modelId],
        replicates: 2,
        firstReplicateNo: 3,
      });
      expect(result.outcomes.map((o) => o.replicateNo)).toEqual([3, 4]);
      const rows = await db.generation.findMany({ orderBy: { replicateNo: 'asc' } });
      expect(rows.map((r) => r.replicateNo)).toEqual([3, 4]);
    });

    it('sonuç her çağrı için token sayısını ve (fiyat biliniyorsa) maliyeti taşır; başarısızda boştur', async () => {
      const { generation } = build();
      const result = await generation.generate({
        genre: 'siir',
        theme: 'Sonbahar',
        modelIds: [modelId],
      });
      const outcome = result.outcomes[0]!;
      const row = await db.generation.findFirstOrThrow();
      expect(outcome.inputTokens).toBe(row.inputTokens);
      expect(outcome.outputTokens).toBe(row.outputTokens);
      expect(outcome.costUsd).toBeCloseTo((row.inputTokens! * 1 + row.outputTokens! * 2) / 1e6, 12);

      // Fiyatsız model: maliyet bilinmez.
      await db.providerModel.update({ where: { id: modelId }, data: { defaultParams: {} } });
      const unpriced = await build().generation.generate({
        genre: 'siir',
        theme: 'Deniz',
        modelIds: [modelId],
      });
      expect(unpriced.outcomes[0]).toMatchObject({ status: 'succeeded', costUsd: null });

      // Başarısız çağrı: token ve maliyet yok.
      const failing = build({
        anthropic: () => {
          throw new ProviderError('auth', 'anahtar');
        },
      });
      const failed = await failing.generation.generate({
        genre: 'siir',
        theme: 'Rüzgâr',
        modelIds: [modelId],
      });
      expect(failed.outcomes[0]).toMatchObject({
        status: 'failed',
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      });
    });

    it('depo: başarılı üretimleri listeler (şablona ve modele göre) ve yarım kalanı failed yapar', async () => {
      const { generation } = build();
      await generation.generate({
        genre: 'siir',
        theme: 'Sonbahar',
        modelIds: [modelId],
        replicates: 2,
      });
      const templateId = (await templates.getLatest('generate')).id;
      const running = await generationsRepo.start({
        providerModelId: modelId,
        promptTemplateId: templateId,
        genre: 'siir',
        theme: 'Sonbahar',
        replicateNo: 3,
        params: {},
      });

      const succeeded = await generationsRepo.findSucceeded({
        promptTemplateId: templateId,
        providerModelIds: [modelId],
      });
      expect(succeeded.map((s) => s.replicateNo).sort()).toEqual([1, 2]); // running olan yok
      expect(
        await generationsRepo.findSucceeded({
          promptTemplateId: templateId + 999,
          providerModelIds: [modelId],
        }),
      ).toEqual([]);

      expect(await generationsRepo.failInterrupted('sunucu kapandı, yarım kaldı')).toBe(1);
      const row = await db.generation.findUniqueOrThrow({ where: { id: running } });
      expect(row).toMatchObject({ status: 'failed', error: 'sunucu kapandı, yarım kaldı' });
      expect(await generationsRepo.failInterrupted('x')).toBe(0);
      expect((await db.generation.count({ where: { status: 'succeeded' } })).valueOf()).toBe(2);
    });
  });

  describe('MySQL: toplu üretim işi (generate_batch)', () => {
    let ids: { a: number; g: number; o: number };
    const topics = [
      { genre: 'siir', theme: 'Sonbahar' },
      { genre: 'hikaye', theme: 'Deniz' },
    ];
    const rawJob = (over: Record<string, unknown> = {}) => ({
      topics,
      modelIds: [ids.a, ids.g, ids.o],
      replicates: 2,
      ...over,
    });
    const addModel = (provider: string, over: Record<string, unknown> = {}) =>
      db.providerModel.create({
        data: {
          provider,
          modelId: `m-${provider}`,
          displayName: provider,
          active: true,
          defaultParams: params,
          ...over,
        },
      });

    beforeEach(async () => {
      await clean();
      await templates.createTemplate({ kind: 'generate', version: 'v1', body: TEMPLATE_BODY });
      ids = {
        a: (await addModel('anthropic')).id,
        g: (await addModel('google')).id,
        o: (await addModel('openai')).id,
      };
    });

    it('iş eklerken en son şablonu sabitler, toplam öğe sayısını hesaplar', async () => {
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      const templateId = (await templates.getLatest('generate')).id;
      expect(job).toMatchObject({ type: GENERATE_BATCH, status: 'pending', total: 12 }); // 2 konu × 3 model × 2 tekrar
      expect(job.payload).toMatchObject({
        templateId,
        replicates: 2,
        modelIds: [ids.a, ids.g, ids.o],
      });
    });

    it('geçersiz işi reddeder, kuyruğa hiçbir şey yazılmaz', async () => {
      for (const bad of [
        rawJob({ topics: [] }),
        rawJob({ topics: [{ genre: 'roman', theme: 'x' }] }),
        rawJob({ topics: [{ genre: 'siir', theme: 'a'.repeat(33) }] }),
        rawJob({ topics: [{ genre: 'siir', theme: 'iki\nsatır' }] }),
        rawJob({ modelIds: [] }),
        rawJob({ modelIds: [ids.a, ids.a] }),
        rawJob({ replicates: 0 }),
        rawJob({ replicates: 11 }),
        rawJob({ maxCostUsd: 0 }),
        rawJob({ yazimHatasi: 1 }),
      ]) {
        await expect(
          enqueueGenerateBatch({ jobs, templates }, bad),
          JSON.stringify(bad),
        ).rejects.toThrow();
      }
      expect(await db.job.count()).toBe(0);
    });

    it('tüm öğeleri üretir ve kaydeder; ilerleme sayaçları ve sonuç yazılır', async () => {
      const { runner, mocks } = build();
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await runner.runUntilIdle();

      expect(await jobs.findById(job.id)).toMatchObject({
        status: 'succeeded',
        total: 12,
        done: 12,
        failed: 0,
        result: { done: 12, failed: 0 },
      });
      expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(12);
      expect(await db.text.count()).toBe(12);
      for (const provider of Object.values(mocks)) expect(provider.calls).toHaveLength(4);

      // Her (konu, model) için tekrar numaraları 1 ve 2.
      const rows = await db.generation.findMany({
        where: { providerModelId: ids.a, genre: 'siir' },
        orderBy: { replicateNo: 'asc' },
      });
      expect(rows.map((r) => r.replicateNo)).toEqual([1, 2]);
    });

    it('sağlayıcılar paralel şeritlerde çalışır, her sağlayıcıya aynı anda tek istek gider', async () => {
      const events: string[] = [];
      const inFlight = { anthropic: 0, google: 0, openai: 0 };
      let maxInFlight = 0;
      const lane = (name: 'anthropic' | 'google' | 'openai', delay: number): Responder => {
        let n = 0;
        return async (req) => {
          inFlight[name]++;
          maxInFlight = Math.max(maxInFlight, inFlight[name]);
          await new Promise((r) => setTimeout(r, delay));
          inFlight[name]--;
          events.push(`${name}#${++n}`);
          return ok(req);
        };
      };
      const { runner } = build({
        google: lane('google', 60), // yavaş sağlayıcı (Gemini 4 Hydrogen gibi)
        anthropic: lane('anthropic', 3),
        openai: lane('openai', 3),
      });
      // Yavaş sağlayıcı ilk şeritte: sıralı çalışsaydı diğerleri onu beklerdi.
      await enqueueGenerateBatch({ jobs, templates }, rawJob({ modelIds: [ids.g, ids.a, ids.o] }));
      await runner.runUntilIdle();

      expect(maxInFlight).toBe(1);
      expect(events.indexOf('anthropic#4')).toBeLessThan(events.indexOf('google#3'));
      expect(events.indexOf('openai#4')).toBeLessThan(events.indexOf('google#3'));
      expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(12);
    });

    it('bir sağlayıcının hatası işi durdurmaz: o şeridin öğeleri failed sayılır, diğerleri sürer (T09)', async () => {
      const { runner } = build({
        google: () => {
          throw new ProviderError('auth', 'anahtar geçersiz');
        },
      });
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await runner.runUntilIdle();

      expect(await jobs.findById(job.id)).toMatchObject({
        status: 'succeeded',
        done: 8,
        failed: 4,
      });
      const failed = await db.generation.findMany({ where: { status: 'failed' } });
      expect(failed).toHaveLength(4);
      expect(failed.every((r) => r.providerModelId === ids.g && r.error?.includes('auth'))).toBe(
        true,
      );
    });

    it('beklenmeyen (sağlayıcı dışı) hata işi failed yapar ve nedeni yazar', async () => {
      const { runner } = build({
        openai: () => {
          throw new TypeError('kod hatası');
        },
      });
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await runner.runUntilIdle();
      const stored = await jobs.findById(job.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.error).toContain('kod hatası');
      expect(await db.generation.count({ where: { status: 'running' } })).toBe(0); // takılı kalan yok
    });

    it('çalışırken ilerleme veritabanında görünür (tek şeritte her öğeden sonra)', async () => {
      let jobId = 0;
      const seen: number[] = [];
      const { runner } = build({
        anthropic: async (req) => {
          seen.push((await jobs.findById(jobId))?.done ?? -1);
          return ok(req);
        },
      });
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob({ modelIds: [ids.a] }));
      jobId = job.id;
      await runner.runUntilIdle();
      expect(seen).toEqual([0, 1, 2, 3]); // 4 öğe; her çağrıdan önce öncekiler yazılmış
    });

    it('T37: kapatılıp açılınca kalan öğelerden devam eder, hiçbir öğe iki kez üretilmez', async () => {
      let calls = 0;
      const holder: { runner?: JobRunner } = {};
      const stopAfterFive: Responder = (req) => {
        if (++calls === 5) void holder.runner?.stop();
        return ok(req);
      };
      const first = build({
        anthropic: stopAfterFive,
        google: stopAfterFive,
        openai: stopAfterFive,
      });
      holder.runner = first.runner;
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await first.runner.runNext();

      const mid = await jobs.findById(job.id);
      expect(mid?.status).toBe('pending'); // kapanışta bekleyene döndü
      expect(mid!.done).toBeGreaterThanOrEqual(5);
      expect(mid!.done).toBeLessThan(12);

      await build().runner.runUntilIdle();
      expect(await jobs.findById(job.id)).toMatchObject({ status: 'succeeded', done: 12 });

      const rows = await db.generation.findMany({ where: { status: 'succeeded' } });
      expect(rows).toHaveLength(12);
      const keys = rows.map((r) => `${r.providerModelId}|${r.genre}|${r.theme}|${r.replicateNo}`);
      expect(new Set(keys).size).toBe(12); // tekrar yok
    });

    it('çökme sonrası "çalışıyor" kalan üretim kaydı failed yapılır, öğe yeni kayıtla yeniden üretilir', async () => {
      const job = await enqueueGenerateBatch(
        { jobs, templates },
        rawJob({ modelIds: [ids.a], replicates: 1 }),
      );
      const templateId = (await templates.getLatest('generate')).id;
      // Çöküş: iş sahiplenildi, bir üretim başladı ama bitmedi.
      await jobs.claimNext();
      const stale = await generationsRepo.start({
        providerModelId: ids.a,
        promptTemplateId: templateId,
        genre: 'siir',
        theme: 'Sonbahar',
        replicateNo: 1,
        params: {},
      });

      const { runner } = build();
      await runner.recover();
      await runner.runUntilIdle();

      expect((await db.generation.findUniqueOrThrow({ where: { id: stale } })).error).toContain(
        'yarım kaldı',
      );
      expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(2); // 2 konu × 1 model
      expect(await db.generation.count({ where: { status: 'running' } })).toBe(0);
      expect((await jobs.findById(job.id))?.status).toBe('succeeded');
    });

    it('bütçe dolunca iş durur ve nedenini yazar; yeni iş kalan öğeleri tamamlar, biteni atlar', async () => {
      // Her çağrı yaklaşık birkaç dolar tutsun (fiyat çok yüksek): bütçe hızla dolar.
      await db.providerModel.updateMany({
        data: {
          defaultParams: { maxTokens: 200, priceUsdPerMillion: { input: 1e6, output: 1e6 } },
        },
      });
      const { runner } = build();
      const small = await enqueueGenerateBatch({ jobs, templates }, rawJob({ maxCostUsd: 100 }));
      await runner.runUntilIdle();

      const stopped = await jobs.findById(small.id);
      expect(stopped?.status).toBe('failed');
      expect(stopped?.error).toContain('Bütçe');
      const made = await db.generation.count({ where: { status: 'succeeded' } });
      expect(made).toBeGreaterThanOrEqual(1);
      expect(made).toBeLessThan(12);

      const rest = await enqueueGenerateBatch({ jobs, templates }, rawJob({ maxCostUsd: 100000 }));
      await runner.runUntilIdle();
      expect(await jobs.findById(rest.id)).toMatchObject({ status: 'succeeded', done: 12 });
      expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(12); // kalanlar yapıldı, biten tekrarlanmadı
    });

    it('fiyatı bilinmeyen model varken bütçe verilirse iş çağrı yapılmadan failed olur (sınır garanti edilemez)', async () => {
      await db.providerModel.update({ where: { id: ids.g }, data: { defaultParams: {} } });
      const { runner, mocks } = build();
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob({ maxCostUsd: 5 }));
      await runner.runUntilIdle();
      expect((await jobs.findById(job.id))?.error).toContain('Fiyat bilgisi olmayan');
      expect(await db.generation.count()).toBe(0);
      for (const provider of Object.values(mocks)) expect(provider.calls).toHaveLength(0);

      // Bütçe verilmezse fiyatsız model çalışır.
      const free = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await runner.runUntilIdle();
      expect((await jobs.findById(free.id))?.status).toBe('succeeded');
    });

    it('şablon iş eklendikten sonra değişmişse iş failed olur, hiçbir çağrı yapılmaz (veri tutarlılığı)', async () => {
      const job = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await templates.createTemplate({ kind: 'generate', version: 'v2', body: TEMPLATE_BODY });
      const { runner, mocks } = build();
      await runner.runUntilIdle();

      const stored = await jobs.findById(job.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.error).toContain('şablon');
      expect(await db.generation.count()).toBe(0);
      for (const provider of Object.values(mocks)) expect(provider.calls).toHaveLength(0);
    });

    it('kapalı ya da olmayan model, anahtarı olmayan sağlayıcı: iş çağrı yapılmadan failed olur', async () => {
      const { runner, mocks } = build();
      await db.providerModel.update({ where: { id: ids.g }, data: { active: false } });
      const closed = await enqueueGenerateBatch({ jobs, templates }, rawJob());
      await runner.runUntilIdle();
      expect((await jobs.findById(closed.id))?.status).toBe('failed');
      expect((await jobs.findById(closed.id))?.error).toContain(String(ids.g));

      await db.providerModel.update({
        where: { id: ids.g },
        data: { active: true, provider: 'bilinmeyen' },
      });
      await db.providerModel.update({ where: { id: ids.o }, data: { provider: 'mock' } }); // kayıt defterinde yok
      // Anahtarı olan bir sağlayıcıyla birlikte: eksik sağlayıcı baştan yakalanmazsa diğer şerit çoktan harcamış olur.
      const missing = await enqueueGenerateBatch(
        { jobs, templates },
        rawJob({ modelIds: [ids.a, ids.o] }),
      );
      await runner.runUntilIdle();
      expect((await jobs.findById(missing.id))?.status).toBe('failed');
      expect((await jobs.findById(missing.id))?.error).toContain('kullanılamıyor');

      expect(await db.generation.count()).toBe(0);
      for (const provider of Object.values(mocks)) expect(provider.calls).toHaveLength(0);
    });
  });
} else if (process.env.CI) {
  describe('MySQL: toplu üretim işi', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: toplu üretim işi (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
