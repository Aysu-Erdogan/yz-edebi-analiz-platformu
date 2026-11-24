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
import { PrismaGenerationRepository } from '../src/repositories/prisma-generation.repository.js';
import { PrismaJobRepository } from '../src/repositories/prisma-job.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { runBatchCli, type BatchCliDeps } from '../src/services/batch-cli.js';
import { enqueueGenerateBatch } from '../src/services/generate-batch.js';
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
const rubricFor = (genre: string) => ({
  genre,
  version: '0.1-test',
  scale: { min: 1, max: 5 },
  criteria: [
    { key: 'imge', label: 'İmge', description: 'imge gücü', weight: 0.5, levels },
    { key: 'ritim', label: 'Ritim', description: 'ahenk', weight: 0.3, levels },
    { key: 'ozgun', label: 'Özgünlük', description: 'özgünlük', weight: 0.2, levels },
  ],
});
const goodJudge = JSON.stringify({
  puanlar: {
    imge: { puan: 5, gerekce: 'a' },
    ritim: { puan: 3, gerekce: 'b' },
    ozgun: { puan: 1, gerekce: 'c' },
  },
});
const params = { maxTokens: 200, priceUsdPerMillion: { input: 1, output: 2 } };
const MODELS = 'claude-sonnet-5-5,gemini-4-hydrogen,gpt-6.2-sol';
const TOPICS = 'siir:Sonbahar,hikaye:Deniz';

type Responder = (req: GenerateRequest) => string | Promise<string>;
/** Hem üretim (düz metin) hem hakem (şemalı JSON) isteğine cevap verir. */
const standard: Responder = (req) => ('schema' in req ? goodJudge : `[${req.model}] metin`);

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  const jobs = new PrismaJobRepository(db);
  const modelsRepo = new PrismaProviderModelRepository(db);
  const generationsRepo = new PrismaGenerationRepository(db);
  const evaluationsRepo = new PrismaEvaluationRepository(db);
  const templates = createPromptTemplateService(new PrismaPromptTemplateRepository(db));
  const rubrics = createRubricService(new PrismaRubricRepository(db));
  const clean = async () => {
    await db.job.deleteMany();
    await cleanRubricData(db);
  };
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  describe('MySQL: toplu komut satırı (batch)', () => {
    let mocks: Record<'anthropic' | 'google' | 'openai', MockProvider>;

    function setup(
      responder: Responder = standard,
      options: { withoutProvider?: string; abort?: AbortSignal } = {},
    ) {
      mocks = {
        anthropic: new MockProvider({ respond: responder }),
        google: new MockProvider({ respond: responder }),
        openai: new MockProvider({ respond: responder }),
      };
      const providers: ProviderRegistry = {
        get(id) {
          const found =
            id === options.withoutProvider
              ? undefined
              : (mocks as Record<string, MockProvider>)[id];
          if (!found)
            throw AppError.unavailable(
              `${id} sağlayıcısı kullanılamıyor: API anahtarı tanımlı değil`,
            );
          return found;
        },
      };
      const deps: BatchCliDeps = {
        jobs,
        templates,
        rubrics,
        models: modelsRepo,
        generations: generationsRepo,
        evaluations: evaluationsRepo,
        providers,
        resilience: { sleep: async () => {} },
        pollMs: 5,
        progressMs: 20,
      };
      const run = async (...argv: string[]) => {
        const lines: string[] = [];
        const code = await runBatchCli(argv, deps, (line) => lines.push(line), options.abort);
        return { code, output: lines.join('\n') };
      };
      return { run, providers, deps };
    }

    const addModel = (provider: string, modelId: string, over: Record<string, unknown> = {}) =>
      db.providerModel.create({
        data: {
          provider,
          modelId,
          displayName: modelId,
          active: true,
          defaultParams: params,
          ...over,
        },
      });

    beforeEach(async () => {
      await clean();
      await templates.createTemplate({
        kind: 'generate',
        version: 'v1',
        body: 'Tür: {{tur}}\nTema: {{tema}}\nUzunluk: {{uzunluk}}',
      });
      await templates.createTemplate(judgeTemplate);
      for (const genre of ['siir', 'hikaye']) {
        await rubrics.activateRubric((await rubrics.importRubric(rubricFor(genre))).id);
      }
      await addModel('anthropic', 'claude-sonnet-5-5');
      await addModel('google', 'gemini-4-hydrogen');
      await addModel('openai', 'gpt-6.2-sol');
    });

    const uret = (extra: string[] = []) => [
      'uret',
      '--konular',
      TOPICS,
      '--modeller',
      MODELS,
      ...extra,
    ];

    describe('uret', () => {
      it('--calistir yoksa yalnızca planı gösterir: iş, üretim ve model çağrısı olmaz', async () => {
        const { run } = setup();
        const { code, output } = await run(...uret(['--tekrar', '2']));
        expect(code).toBe(0);
        expect(output).toContain('Plan: toplu üretim');
        expect(output).toContain('gerçek çağrı yapılmadı');
        expect(output).toContain('Toplam öğe: 12'); // 2 konu × 3 model × 2 tekrar
        expect(output).toContain('Şerit anthropic: 4 öğe');
        expect(output).toContain('Komut şablonu: v1');
        expect(output).toContain('En kötü durum üst sınırı: $');
        expect(output).toContain('--calistir');
        expect((await run(...uret(['--butce', '2']))).output).toContain('Bütçe sınırı: $2');
        expect(await db.job.count()).toBe(0);
        expect(await db.generation.count()).toBe(0);
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
      });

      it('--calistir ile işi ekler ve bitirir: üretimler kaydedilir, özet yazılır, çıkış kodu 0', async () => {
        const { run } = setup();
        const { code, output } = await run(...uret(['--tekrar', '2', '--calistir']));
        expect(code).toBe(0);
        const job = await db.job.findFirstOrThrow();
        expect(job).toMatchObject({
          type: 'generate_batch',
          status: 'succeeded',
          total: 12,
          done: 12,
        });
        expect(output).toContain(`İş #${job.id} bitti: 12/12 tamam, 0 başarısız`);
        expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(12);
        expect(await db.text.count()).toBe(12);
      });

      it('bazı öğeler başarısız olursa iş biter ama çıkış kodu 1 olur ve özet başarısızları söyler', async () => {
        const { run } = setup((req) => {
          if (req.model === 'gemini-4-hydrogen') throw new ProviderError('auth', 'anahtar');
          return standard(req);
        });
        const { code, output } = await run(...uret(['--tekrar', '2', '--calistir']));
        expect(code).toBe(1);
        expect(output).toContain('8/12 tamam, 4 başarısız');
        expect((await db.job.findFirstOrThrow()).status).toBe('succeeded');
      });

      it('çalışırken ilerleme satırı yazar', async () => {
        const slow: Responder = async (req) => {
          await new Promise((r) => setTimeout(r, 40));
          return standard(req);
        };
        const { run } = setup(slow);
        const { output } = await run(
          ...uret(['--konular', 'siir:Sonbahar', '--tekrar', '2', '--calistir']),
        );
        expect(output).toMatch(/\[iş #\d+\] \d+\/6 tamam, \d+ başarısız/);
      });

      it('geçmiş yokken tahmini "bilinmiyor" der; bir çalıştırmadan sonra aynı plan ortalama süre ve maliyeti gösterir', async () => {
        const { run } = setup();
        const before = await run(...uret());
        expect(before.output).toContain('geçmiş yok');
        expect(before.output).toContain('Tahmini toplam süre: bilinmiyor');
        expect(before.output).toContain('Beklenen maliyet: bilinmiyor');

        await run(...uret(['--calistir']));
        const after = await run(...uret());
        expect(after.output).not.toContain('geçmiş yok');
        expect(after.output).toMatch(/ortalama \d+(\.\d+)? sn\/öğe/);
        expect(after.output).toMatch(/Tahmini toplam süre: \d+ sn/);
        expect(after.output).toMatch(/Beklenen maliyet: \$\d/);
      });

      it('anahtarı olmayan sağlayıcıyı planda uyarır; --calistir iş failed olur, çağrı yapılmaz', async () => {
        const { run } = setup(standard, { withoutProvider: 'openai' });
        const plan = await run(...uret());
        expect(plan.output).toContain('⚠');
        expect(plan.output).toContain('openai');

        const { code, output } = await run(...uret(['--calistir']));
        expect(code).toBe(1);
        expect(output).toContain('kullanılamıyor');
        expect((await db.job.findFirstOrThrow()).status).toBe('failed');
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
      });

      it('bütçe dolunca iş durur, neden yazılır, çıkış kodu 1; aynı komutla yeni iş kalanı tamamlar', async () => {
        await db.providerModel.updateMany({
          data: {
            defaultParams: { maxTokens: 200, priceUsdPerMillion: { input: 1e6, output: 1e6 } },
          },
        });
        const { run } = setup();
        const stopped = await run(...uret(['--tekrar', '2', '--butce', '100', '--calistir']));
        expect(stopped.code).toBe(1);
        expect(stopped.output).toContain('Bütçe doldu');
        const made = await db.generation.count({ where: { status: 'succeeded' } });
        expect(made).toBeGreaterThanOrEqual(1);
        expect(made).toBeLessThan(12);

        const rest = await run(...uret(['--tekrar', '2', '--butce', '1000000000', '--calistir']));
        expect(rest.code).toBe(0);
        expect(await db.generation.count({ where: { status: 'succeeded' } })).toBe(12);
      });

      it('durdurma sinyali gelince çalışan öğe biter, iş bekleyene döner; devam komutu kalanı tamamlar', async () => {
        const controller = new AbortController();
        let calls = 0;
        const { run: first } = setup(
          (req) => {
            if (++calls === 4) controller.abort();
            return standard(req);
          },
          { abort: controller.signal },
        );
        const stopped = await first(...uret(['--tekrar', '2', '--calistir']));
        expect(stopped.code).toBe(0);
        expect(stopped.output).toContain('durduruldu');
        expect(stopped.output).toContain('devam');
        expect((await db.job.findFirstOrThrow()).status).toBe('pending');

        const { run: second } = setup();
        const resumed = await second('devam');
        expect(resumed.code).toBe(0);
        expect((await db.job.findFirstOrThrow()).status).toBe('succeeded');
        const rows = await db.generation.findMany({ where: { status: 'succeeded' } });
        expect(rows).toHaveLength(12);
        expect(
          new Set(rows.map((r) => `${r.providerModelId}|${r.genre}|${r.theme}|${r.replicateNo}`))
            .size,
        ).toBe(12);
      });
    });

    it('kuyrukta bitmemiş iş varken yeni iş eklemez (önce devam ile sürdürülmeli); planı yine gösterir', async () => {
      const { run } = setup();
      await enqueueGenerateBatch(
        { jobs, templates },
        {
          topics: [{ genre: 'siir', theme: 'Eski' }],
          modelIds: (await db.providerModel.findMany()).map((m) => m.id),
        },
      );
      const plan = await run(...uret());
      expect(plan.code).toBe(0); // plan harcamaz, her zaman gösterilir

      const { code, output } = await run(...uret(['--calistir']));
      expect(code).toBe(2);
      expect(output).toContain('Kuyrukta bitmemiş iş var');
      expect(output).toContain('devam');
      expect(await db.job.count()).toBe(1); // yeni iş eklenmedi, eskisi çalıştırılmadı
      expect(await db.generation.count()).toBe(0);
      for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);
    });

    describe('puanla', () => {
      beforeEach(async () => {
        const { run } = setup();
        await run(...uret(['--calistir'])); // 6 üretilmiş metin: 2 konu × 3 model
        await db.job.deleteMany();
      });

      it('--calistir yoksa planı gösterir; kendini dışlamayı ve hakem sertliği gerekçesini söyler, hiçbir şey yazmaz', async () => {
        const { run } = setup();
        const { code, output } = await run('puanla', '--metinler', 'hepsi', '--hakemler', MODELS);
        expect(code).toBe(0);
        expect(output).toContain('Plan: toplu puanlama');
        expect(output).toContain('gerçek çağrı yapılmadı');
        expect(output).toContain('Toplam öğe: 18'); // 6 metin × 3 hakem
        expect(output).toContain('Hakem komut şablonu: v1');
        expect(output).toContain('Rubrik: siir 0.1-test');
        expect(output).toContain('tüm hakemler her metni puanlar');
        expect(await db.job.count()).toBe(0);
        expect(await db.evaluation.count()).toBe(0);
        for (const m of Object.values(mocks)) expect(m.calls).toHaveLength(0);

        const exclude = await run(
          'puanla',
          '--metinler',
          'hepsi',
          '--hakemler',
          MODELS,
          '--kendini-disla',
        );
        expect(exclude.output).toContain('Toplam öğe: 12'); // her hakem 2 üretilmiş metni dışlar
        expect(exclude.output).toContain('kendi ailesinin metnini puanlamaz');
      });

      it('--calistir ile işi ekler ve bitirir: puanlamalar kaydedilir', async () => {
        const { run } = setup();
        const { code, output } = await run(
          'puanla',
          '--metinler',
          'hepsi',
          '--hakemler',
          MODELS,
          '--calistir',
        );
        expect(code).toBe(0);
        const job = await db.job.findFirstOrThrow();
        expect(job).toMatchObject({
          type: 'evaluate_batch',
          status: 'succeeded',
          total: 18,
          done: 18,
        });
        expect(output).toContain(`İş #${job.id} bitti: 18/18 tamam, 0 başarısız`);
        // Puanlama geçmişi oluştu: aynı plan artık ortalama süre ve maliyeti gösterir.
        const again = await run('puanla', '--metinler', 'hepsi', '--hakemler', MODELS);
        expect(again.output).toMatch(/ortalama \d+(\.\d+)? sn\/öğe/);
        expect(again.output).toMatch(/Beklenen maliyet: \$\d/);
        expect(await db.evaluation.count({ where: { status: 'succeeded' } })).toBe(18);
      });

      it('metinleri kimlik listesi, aralık ya da tür süzgeciyle seçer', async () => {
        const { run } = setup();
        const ids = (await db.text.findMany({ orderBy: { id: 'asc' } })).map((t) => t.id);
        const list = await run('puanla', '--metinler', `${ids[0]},${ids[1]}`, '--hakemler', MODELS);
        expect(list.output).toContain('Toplam öğe: 6'); // 2 metin × 3 hakem

        const range = await run(
          'puanla',
          '--metinler',
          `${ids[0]}-${ids[2]}`,
          '--hakemler',
          MODELS,
        );
        expect(range.output).toContain('Toplam öğe: 9');

        const genre = await run(
          'puanla',
          '--metinler',
          'hepsi',
          '--tur',
          'siir',
          '--hakemler',
          MODELS,
        );
        expect(genre.output).toContain('Toplam öğe: 9'); // 3 şiir × 3 hakem
      });

      it('bütçe dolunca puanlama işi durur, nedeni yazılır, çıkış kodu 1', async () => {
        await db.providerModel.updateMany({
          data: {
            defaultParams: { maxTokens: 200, priceUsdPerMillion: { input: 1e6, output: 1e6 } },
          },
        });
        const { run } = setup();
        const { code, output } = await run(
          'puanla',
          '--metinler',
          'hepsi',
          '--hakemler',
          MODELS,
          '--butce',
          '1000',
          '--calistir',
        );
        expect(code).toBe(1);
        expect(output).toContain('Bütçe doldu');
        const made = await db.evaluation.count({ where: { status: 'succeeded' } });
        expect(made).toBeGreaterThanOrEqual(1);
        expect(made).toBeLessThan(18);
      });

      it('olmayan metin kimliğini reddeder (çıkış kodu 2), hiçbir iş eklenmez', async () => {
        const { run } = setup();
        const { code, output } = await run(
          'puanla',
          '--metinler',
          '999999',
          '--hakemler',
          MODELS,
          '--calistir',
        );
        expect(code).toBe(2);
        expect(output).toContain('999999');
        expect(await db.job.count()).toBe(0);
      });
    });

    describe('devam ve durum', () => {
      it('bekleyen iş yokken bunu söyler', async () => {
        const { run } = setup();
        const { code, output } = await run('devam');
        expect(code).toBe(0);
        expect(output).toContain('Bekleyen iş yok');
      });

      it('çökmeden yarım kalan işi geri alır ve tamamlar', async () => {
        const { run, deps } = setup();
        const job = await enqueueGenerateBatch(
          { jobs, templates },
          {
            topics: [{ genre: 'siir', theme: 'Sonbahar' }],
            modelIds: (await db.providerModel.findMany()).map((m) => m.id),
          },
        );
        await jobs.claimNext(); // çöküş: sahiplenildi ama bitmedi
        expect(deps).toBeDefined();

        const { code, output } = await run('devam');
        expect(code).toBe(0);
        expect(output).toContain('yarım kalan 1 iş geri alındı');
        expect((await jobs.findById(job.id))?.status).toBe('succeeded');
      });

      it('durum komutu işleri listeler: kimlik, tür, durum, ilerleme', async () => {
        const { run } = setup();
        await run(...uret(['--calistir']));
        const job = await db.job.findFirstOrThrow();
        const { code, output } = await run('durum');
        expect(code).toBe(0);
        expect(output).toContain(`#${job.id}`);
        expect(output).toContain('generate_batch');
        expect(output).toContain('succeeded');
        expect(output).toContain('6/6');

        await db.job.deleteMany();
        expect((await run('durum')).output).toContain('Hiç iş yok');
      });
    });

    describe('kullanım hataları', () => {
      it('puanlanacak metin yoksa bunu açıkça söyler (henüz üretim yapılmadı)', async () => {
        const { run } = setup();
        const { code, output } = await run('puanla', '--metinler', 'hepsi', '--hakemler', MODELS);
        expect(code).toBe(2);
        expect(output).toContain('Puanlanacak metin yok');
      });

      it('aynı model adı iki sağlayıcıda varsa belirsizliği söyler', async () => {
        await addModel('google', 'claude-sonnet-5-5'); // aynı ad, başka sağlayıcı
        const { run } = setup();
        const { code, output } = await run(...uret());
        expect(code).toBe(2);
        expect(output).toContain('belirsiz');
        expect(output).toContain('claude-sonnet-5-5');
      });

      it('hatalı komut satırı çıkış kodu 2 ve açıklayıcı ileti verir; hiçbir şey yazılmaz', async () => {
        const { run } = setup();
        const bad: string[][] = [
          [],
          ['bilinmeyen'],
          ['uret', '--modeller', MODELS],
          ['uret', '--konular', TOPICS],
          ['uret', '--konular', TOPICS, '--modeller', 'olmayan-model'],
          ['uret', '--konular', 'roman:Aşk', '--modeller', MODELS],
          ['uret', '--konular', TOPICS, '--modeller', MODELS, '--tekrar', '0'],
          ['uret', '--konular', TOPICS, '--modeller', MODELS, '--tekrar', '11'],
          ['uret', '--konular', TOPICS, '--modeller', MODELS, '--butce', '-1'],
          ['uret', '--konular', TOPICS, '--modeller', MODELS, '--butce', 'çok'],
          ['puanla', '--hakemler', MODELS],
          ['puanla', '--metinler', 'hepsi'],
          ['puanla', '--metinler', 'hepsi', '--hakemler', 'olmayan-model'],
          ['puanla', '--metinler', 'hepsi', '--tur', 'roman', '--hakemler', MODELS],
          ['puanla', '--metinler', '1,2', '--tur', 'siir', '--hakemler', MODELS], // --tur yalnızca hepsi ile
          ['uret', '--konular', TOPICS, '--modeller', MODELS, '--kendini-disla'], // puanla'ya özgü seçenek
          ['durum', '--calistir'],
          ['puanla', '--metinler', 'hepsi', '--hakemler', MODELS], // henüz metin yok
        ];
        for (const argv of bad) {
          const { code, output } = await run(...argv);
          expect(code, argv.join(' ')).toBe(2);
          expect(output.length, argv.join(' ')).toBeGreaterThan(0);
        }
        expect(await db.job.count()).toBe(0);
        const unknown = await run('uret', '--konular', TOPICS, '--modeller', 'olmayan-model');
        expect(unknown.output).toContain('olmayan-model');
      });
    });
  });
} else if (process.env.CI) {
  describe('MySQL: toplu komut satırı', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: toplu komut satırı (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
