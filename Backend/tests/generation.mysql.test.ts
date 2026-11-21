import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GENRES } from '../src/domain/rubric.js';
import { createDb } from '../src/lib/prisma.js';
import { AppError } from '../src/lib/errors.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ProviderError, type GenerateRequest } from '../src/providers/provider.js';
import { createProviderRegistry } from '../src/providers/registry.js';
import { PrismaGenerationRepository } from '../src/repositories/prisma-generation.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import {
  createGenerationService,
  type GenerationService,
} from '../src/services/generation.service.js';
import { createPromptTemplateService } from '../src/services/prompt-template.service.js';
import { cleanGenerationData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();
const TEMPLATE_BODY = 'Tür: {{tur}}\nTema: {{tema}}\nUzunluk: {{uzunluk}}';
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
  afterAll(async () => {
    await db.$disconnect();
  });

  describe('MySQL: metin üretim servisi', () => {
    let ids: { a: number; b: number; c: number };
    let templateId: number;
    let mock: MockProvider;
    let service: GenerationService;

    const ok = (req: GenerateRequest) => `[${req.model}] ürettiği metin`;

    /** Servisi, verilen cevap davranışıyla kurar. Bekleme atlanır, testler hızlı kalır. */
    function build(respond: (req: GenerateRequest) => string | Promise<string> = ok) {
      mock = new MockProvider({ respond });
      service = createGenerationService({
        models: new PrismaProviderModelRepository(db),
        generations: new PrismaGenerationRepository(db),
        templates: createPromptTemplateService(new PrismaPromptTemplateRepository(db)),
        providers: createProviderRegistry({ mock }),
        resilience: { sleep: async () => {} },
      });
    }

    const addModel = (modelId: string, over: Record<string, unknown> = {}) =>
      db.providerModel.create({
        data: {
          provider: 'mock',
          modelId,
          displayName: modelId,
          active: true,
          defaultParams: params,
          ...over,
        },
      });

    beforeEach(async () => {
      await cleanGenerationData(db);
      const template = await createPromptTemplateService(
        new PrismaPromptTemplateRepository(db),
      ).createTemplate({
        kind: 'generate',
        version: 'v1',
        body: TEMPLATE_BODY,
      });
      templateId = template.id;
      ids = {
        a: (await addModel('mock-a')).id,
        b: (await addModel('mock-b')).id,
        c: (await addModel('mock-c')).id,
      };
      build();
    });

    const request = () => ({ genre: 'siir', theme: 'Sonbahar', modelIds: [ids.a, ids.b, ids.c] });

    it('üç modele üretir, her çağrıyı ve metni kaydeder (T07 temeli)', async () => {
      const result = await service.generate(request());
      expect(result).toMatchObject({ dryRun: false, succeeded: 3, failed: 0, templateId });
      expect(result.outcomes.map((o) => o.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);

      const rows = await db.generation.findMany({
        include: { text: true },
        orderBy: { id: 'asc' },
      });
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row).toMatchObject({
          status: 'succeeded',
          promptTemplateId: templateId,
          genre: 'siir',
          theme: 'Sonbahar',
          replicateNo: 1,
          error: null,
        });
        expect(row.inputTokens).toBeGreaterThan(0);
        expect(row.outputTokens).toBeGreaterThan(0);
        expect(row.latencyMs).toBeGreaterThanOrEqual(0);
        expect(row.completedAt).toBeInstanceOf(Date);
        expect(row.text).toMatchObject({ genre: 'siir', theme: 'Sonbahar', source: 'generated' });
        expect(row.text?.body).toContain('ürettiği metin');
      }
    });

    it('üretim kaydı yeniden kurulabilmesi için kullanılan değişkenleri ve sınırları yazar', async () => {
      await service.generate({ ...request(), modelIds: [ids.a] });
      const row = await db.generation.findFirstOrThrow();
      expect(row.params).toMatchObject({
        vars: { tur: 'şiir', tema: 'Sonbahar', uzunluk: '3-5 kıta' },
        maxTokens: 500,
        templateVersion: 'v1',
      });
    });

    it('T11: aynı soru her modele aynen gider ve şablondan doldurulmuştur', async () => {
      const result = await service.generate(request());
      expect(mock.calls).toHaveLength(3);
      const prompts = new Set(mock.calls.map((c) => c.prompt));
      expect(prompts.size).toBe(1);
      expect([...prompts][0]).toBe('Tür: şiir\nTema: Sonbahar\nUzunluk: 3-5 kıta');
      expect(result.prompt).toBe([...prompts][0]);
      expect(mock.calls.map((c) => c.model)).toEqual(['mock-a', 'mock-b', 'mock-c']);
      expect(mock.calls.every((c) => c.maxTokens === 500)).toBe(true);
    });

    it('T07: 3 tür x 3 tema x 3 model = 27 kombinasyonun hepsi başarıyla biter', async () => {
      for (const genre of GENRES) {
        for (const theme of ['aşk', 'doğa', 'teknoloji']) {
          const result = await service.generate({ ...request(), genre, theme });
          expect(result.failed).toBe(0);
        }
      }
      expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(27);
      expect(await db.text.count()).toBe(27);
    });

    it('T09: bir model kalıcı hata verirse yalnızca o kayıt failed olur, diğerleri sürer', async () => {
      build((req) => {
        if (req.model === 'mock-b') throw new ProviderError('auth', 'HTTP 401: anahtar geçersiz');
        return ok(req);
      });
      const result = await service.generate(request());

      expect(result).toMatchObject({ succeeded: 2, failed: 1 });
      expect(result.outcomes.map((o) => o.status)).toEqual(['succeeded', 'failed', 'succeeded']);
      const failed = await db.generation.findFirstOrThrow({
        where: { providerModelId: ids.b },
        include: { text: true },
      });
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('auth');
      expect(failed.error).toContain('401');
      expect(failed.completedAt).toBeInstanceOf(Date);
      expect(failed.text).toBeNull(); // başarısız kayıt için metin uydurulmaz
      expect(await db.text.count()).toBe(2);
    });

    it('geçici hata (kota) yeniden denenir ve sonunda başarırsa başarılı kaydedilir (T08)', async () => {
      let attempts = 0;
      build((req) => {
        if (req.model === 'mock-a' && attempts++ < 2)
          throw new ProviderError('rate_limit', 'HTTP 429');
        return ok(req);
      });
      const result = await service.generate({ ...request(), modelIds: [ids.a] });
      expect(result.succeeded).toBe(1);
      expect(mock.calls).toHaveLength(3);
    });

    it('T10: model boş cevap verirse kayıt failed olur, boş metin kaydedilmez', async () => {
      build(() => '   ');
      const result = await service.generate({ ...request(), modelIds: [ids.a] });
      expect(result.failed).toBe(1);
      expect(await db.text.count()).toBe(0);
      expect((await db.generation.findFirstOrThrow()).error).toContain('empty_output');
    });

    it('beklenmeyen (sağlayıcı dışı) hata takılı kalan kayıt bırakmaz: failed yazılır ve hata yukarı atılır', async () => {
      build(() => {
        throw new TypeError('kod hatası');
      });
      await expect(service.generate({ ...request(), modelIds: [ids.a] })).rejects.toThrow(
        TypeError,
      );
      const row = await db.generation.findFirstOrThrow();
      expect(row.status).toBe('failed');
      expect(row.error).toContain('beklenmeyen hata');
    });

    it('tekrar sayısı kadar kayıt üretir, her biri kendi numarasıyla', async () => {
      const result = await service.generate({
        ...request(),
        modelIds: [ids.a, ids.b],
        replicates: 3,
      });
      expect(result.outcomes).toHaveLength(6);
      const rows = await db.generation.findMany({
        where: { providerModelId: ids.a },
        orderBy: { replicateNo: 'asc' },
      });
      expect(rows.map((r) => r.replicateNo)).toEqual([1, 2, 3]);
    });

    it('T12: tahmini maliyet sınırı aşıyorsa hiçbir çağrı yapılmadan reddedilir', async () => {
      const estimate = (await service.generate({ ...request(), dryRun: true })).estimatedCostUsd;
      expect(estimate).toBeGreaterThan(0);

      const error = await appError(service.generate({ ...request(), maxCostUsd: estimate / 2 }));
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect(error.message).toMatch(/maliyet/i);
      expect(mock.calls).toHaveLength(0);
      expect(await db.generation.count()).toBe(0);

      const allowed = await service.generate({ ...request(), maxCostUsd: estimate * 2 });
      expect(allowed.succeeded).toBe(3);
    });

    it('maliyet tahmini en kötü durumu varsayar (çıktı tam token sınırı kadar) ve tekrarla çarpılır', async () => {
      const single = (await service.generate({ ...request(), modelIds: [ids.a], dryRun: true }))
        .estimatedCostUsd;
      const triple = (
        await service.generate({ ...request(), modelIds: [ids.a], replicates: 3, dryRun: true })
      ).estimatedCostUsd;
      expect(triple).toBeCloseTo(single * 3, 12);
      // 500 çıktı token x $2/M = $0.001; girdi küçük olduğundan toplam bunun biraz üstünde.
      expect(single).toBeGreaterThanOrEqual(0.001);
      expect(single).toBeLessThan(0.0012);
    });

    it('deneme çalıştırması (dry-run) yalnızca tahmin verir: çağrı yok, kayıt yok', async () => {
      const result = await service.generate({ ...request(), dryRun: true });
      expect(result).toMatchObject({ dryRun: true, succeeded: 0, failed: 0, outcomes: [] });
      expect(mock.calls).toHaveLength(0);
      expect(await db.generation.count()).toBe(0);
    });

    it('fiyatı bilinmeyen model varken maliyet sınırı verilirse reddedilir (sınır garanti edilemez)', async () => {
      const unpriced = await addModel('mock-fiyatsiz', { defaultParams: { maxTokens: 500 } });
      const withCap = { ...request(), modelIds: [unpriced.id], maxCostUsd: 1 };
      const error = await appError(service.generate(withCap));
      expect(error.message).toContain('mock-fiyatsiz');
      expect(mock.calls).toHaveLength(0);

      // Sınır yoksa çalışır; tahmin fiyatı bilinmeyen modeli listeler.
      const free = await service.generate({ ...request(), modelIds: [unpriced.id] });
      expect(free.succeeded).toBe(1);
      expect(free.unpricedModels).toEqual(['mock-fiyatsiz']);
    });

    it('kapalı ya da olmayan model kimliği hiçbir çağrı yapılmadan reddedilir', async () => {
      await db.providerModel.update({ where: { id: ids.c }, data: { active: false } });
      const closed = await appError(service.generate(request()));
      expect(closed.message).toContain(String(ids.c));
      const missing = await appError(
        service.generate({ ...request(), modelIds: [ids.a, 999_999] }),
      );
      expect(missing.message).toContain('999999');
      expect(mock.calls).toHaveLength(0);
      expect(await db.generation.count()).toBe(0);
    });

    it('anahtarı olmayan sağlayıcının modeli, başka hiçbir şey yapılmadan açık hata verir', async () => {
      const anthropic = await db.providerModel.create({
        data: {
          provider: 'anthropic',
          modelId: 'claude-x',
          displayName: 'Claude X',
          defaultParams: params,
        },
      });
      const error = await appError(
        service.generate({ ...request(), modelIds: [ids.a, anthropic.id] }),
      );
      expect(error).toMatchObject({ status: 503 });
      expect(mock.calls).toHaveLength(0); // ilk (çalışan) model için bile çağrı yapılmadı
      expect(await db.generation.count()).toBe(0);
    });

    it('şablon yoksa 404 verir ve hiçbir şey yapmaz', async () => {
      await db.generation.deleteMany();
      await db.promptTemplate.deleteMany();
      expect(await appError(service.generate(request()))).toMatchObject({ status: 404 });
      expect(mock.calls).toHaveLength(0);
    });

    it('geçersiz istekler reddedilir (boş model listesi, 32 karakteri aşan tema, tür, tekrar sayısı)', async () => {
      const bad = [
        { ...request(), modelIds: [] },
        { ...request(), modelIds: [ids.a, ids.a] },
        { ...request(), theme: 'a'.repeat(33) },
        { ...request(), theme: 'iki\nsatır' },
        { ...request(), genre: 'roman' },
        { ...request(), replicates: 0 },
        { ...request(), replicates: 11 },
        { ...request(), maxCostUsd: 0 },
        { ...request(), yazimHatasi: true },
      ];
      for (const input of bad) {
        await expect(service.generate(input), JSON.stringify(input)).rejects.toThrow();
      }
      expect(mock.calls).toHaveLength(0);
    });

    it('süre sınırı model parametresinden gelir (yavaş modeller için)', async () => {
      await db.providerModel.update({
        where: { id: ids.a },
        data: { defaultParams: { ...params, timeoutMs: 20 } },
      });
      build(() => new Promise<string>(() => {})); // hiç cevap vermez
      const result = await service.generate({ ...request(), modelIds: [ids.a] });
      expect(result.failed).toBe(1);
      expect((await db.generation.findFirstOrThrow()).error).toContain('timeout');
    });
  });
} else if (process.env.CI) {
  describe('MySQL: metin üretim servisi', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: metin üretim servisi (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
