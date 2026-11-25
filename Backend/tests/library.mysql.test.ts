import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/lib/prisma.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { PrismaTextLibraryRepository } from '../src/repositories/prisma-text-library.repository.js';
import { createPromptTemplateService } from '../src/services/prompt-template.service.js';
import { createRubricService } from '../src/services/rubric.service.js';
import { cleanRubricData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

const seedDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/seed-data');
const readSeed = (file: string) => JSON.parse(readFileSync(resolve(seedDir, file), 'utf8'));

const levels = [
  { score: 1, descriptor: 'en düşük' },
  { score: 5, descriptor: 'en yüksek' },
];
// Kriter sırası rubrikteki sıradır (imge, ritim, özgünlük); puan satırları bilerek ters sırada yazılır.
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

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  const cleanAll = () => cleanRubricData(db);
  afterAll(async () => {
    await cleanAll();
    await db.$disconnect();
  });

  describe('MySQL: metin kütüphanesi', () => {
    const library = new PrismaTextLibraryRepository(db);
    let ids: { claude: number; gemini: number; story: number; manual: number };
    let evaluationIds: { ok: number; second: number; failed: number };

    beforeEach(async () => {
      await cleanAll();
      const rubrics = createRubricService(new PrismaRubricRepository(db));
      const rubric = await rubrics.importRubric(rubricInput);
      await rubrics.activateRubric(rubric.id);
      const templates = createPromptTemplateService(new PrismaPromptTemplateRepository(db));
      const generate = await templates.createTemplate(readSeed('prompts/generate-v1.json'));
      const judge = await templates.createTemplate(readSeed('prompts/judge-v1.json'));

      const model = (modelId: string, displayName: string) =>
        db.providerModel.create({
          data: { provider: 'mock', modelId, displayName, active: true, defaultParams: {} },
        });
      const claude = await model('claude-test', 'Claude Test');
      const gemini = await model('gemini-test', 'Gemini Test');

      /** Üretim kaydı ve ona bağlı metin (üretim hattının yazdığı biçimde). */
      const generated = async (
        modelId: number,
        genre: 'siir' | 'hikaye',
        theme: string,
        body: string,
        usage: { inputTokens: number; outputTokens: number; latencyMs: number },
      ) => {
        const generation = await db.generation.create({
          data: {
            providerModelId: modelId,
            promptTemplateId: generate.id,
            genre,
            theme,
            replicateNo: 2,
            params: {},
            status: 'succeeded',
            ...usage,
          },
        });
        return db.text.create({
          data: { genre, theme, body, source: 'generated', generationId: generation.id },
        });
      };

      const t1 = await generated(claude.id, 'siir', 'Doğa', 'Yaprak düşer,\nrüzgâr eser.', {
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 6100,
      });
      const t2 = await generated(gemini.id, 'siir', 'Aşk', 'Gözlerin deniz gibi.', {
        inputTokens: 90,
        outputTokens: 2400,
        latencyMs: 12400,
      });
      const t3 = await generated(claude.id, 'hikaye', 'Doğa', 'Bir varmış bir yokmuş.', {
        inputTokens: 110,
        outputTokens: 900,
        latencyMs: 15000,
      });
      const t4 = await db.text.create({
        data: {
          genre: 'siir',
          theme: 'Sonbahar',
          body: 'Elle yazılmış.',
          source: 'manual',
          label: 'ChatGPT',
        },
      });

      const evaluation = (
        textId: number,
        replicateNo: number,
        status: 'succeeded' | 'failed',
        extra: Record<string, unknown> = {},
      ) =>
        db.evaluation.create({
          data: {
            textId,
            rubricId: rubric.id,
            promptTemplateId: judge.id,
            evaluatorType: 'llm',
            evaluatorRef: 'mock/mock-judge',
            replicateNo,
            status,
            ...extra,
          },
        });
      const ok = await evaluation(t1.id, 1, 'succeeded', {
        totalScore: 65,
        scores: {
          create: [
            { criterionKey: 'ozgun', score: 1, comment: 'özgünlük gerekçesi' },
            { criterionKey: 'imge', score: 5, comment: 'imge gerekçesi' },
            { criterionKey: 'ritim', score: 3, comment: null },
          ],
        },
      });
      const second = await evaluation(t1.id, 2, 'succeeded', {
        totalScore: 80,
        scores: { create: [{ criterionKey: 'imge', score: 4, comment: 'ikinci' }] },
      });
      const failed = await evaluation(t1.id, 3, 'failed', { error: 'hakem geçersiz cevap verdi' });
      await evaluation(t2.id, 1, 'failed', { error: 'başarısız' });

      ids = { claude: t1.id, gemini: t2.id, story: t3.id, manual: t4.id };
      evaluationIds = { ok: ok.id, second: second.id, failed: failed.id };
    });

    it('süzgeçsiz: tüm metinleri kimliğe göre artan sırada, gövdesiyle verir', async () => {
      const all = await library.list({});
      expect(all.map((t) => t.id)).toEqual([ids.claude, ids.gemini, ids.story, ids.manual]);
      expect(all[0]).toMatchObject({
        genre: 'siir',
        theme: 'Doğa',
        source: 'generated',
        label: null,
        body: 'Yaprak düşer,\nrüzgâr eser.',
        author: { provider: 'mock', modelId: 'claude-test', displayName: 'Claude Test' },
      });
      expect(all[0]!.createdAt).toBeInstanceOf(Date);
    });

    it('elle girilen metinde yazar boş, etiket dolu', async () => {
      const manual = (await library.list({ source: 'manual' }))[0]!;
      expect(manual).toMatchObject({ id: ids.manual, author: null, label: 'ChatGPT' });
    });

    it('yalnızca başarılı puanlamaları sayar (başarısızlar ve puansız metin 0)', async () => {
      const byId = Object.fromEntries(
        (await library.list({})).map((t) => [t.id, t.succeededEvaluations]),
      );
      expect(byId).toEqual({
        [ids.claude]: 2, // 2 başarılı + 1 başarısız
        [ids.gemini]: 0, // yalnızca başarısız
        [ids.story]: 0, // hiç puanlama yok
        [ids.manual]: 0,
      });
    });

    it.each([
      ['tür', { genre: 'hikaye' as const }, ['story']],
      ['tema', { theme: 'Doğa' }, ['claude', 'story']],
      ['kaynak: üretilen', { source: 'generated' as const }, ['claude', 'gemini', 'story']],
      ['kaynak: elle girilen', { source: 'manual' as const }, ['manual']],
      ['tür ve tema birlikte', { genre: 'siir' as const, theme: 'Doğa' }, ['claude']],
      [
        'üç süzgeç birlikte',
        { genre: 'siir' as const, theme: 'Aşk', source: 'generated' as const },
        ['gemini'],
      ],
      ['eşleşme yok', { genre: 'deneme' as const }, []],
      [
        'tema büyük küçük harf ayrımı yapmaz (MySQL harmanlama)',
        { theme: 'doğa' },
        ['claude', 'story'],
      ],
    ])('süzgeç: %s', async (_name, filter, expected) => {
      const got = (await library.list(filter)).map((t) => t.id);
      expect(got).toEqual(expected.map((k) => ids[k as keyof typeof ids]));
    });

    it('ayrıntı: üretim bilgisi (şablon sürümü, tekrar no, token, süre) ve yazar', async () => {
      const detail = (await library.get(ids.claude))!;
      expect(detail).toMatchObject({
        id: ids.claude,
        body: 'Yaprak düşer,\nrüzgâr eser.',
        author: { modelId: 'claude-test' },
        generation: {
          templateVersion: 'v1',
          replicateNo: 2,
          inputTokens: 100,
          outputTokens: 200,
          latencyMs: 6100,
        },
        succeededEvaluations: 2,
      });
    });

    it('ayrıntı: puanlamalar kimliğe göre sıralı; puanlar rubrik sırasında, kriter adı ve gerekçesiyle', async () => {
      const detail = (await library.get(ids.claude))!;
      expect(detail.evaluations.map((e) => [e.id, e.replicateNo, e.status])).toEqual([
        [evaluationIds.ok, 1, 'succeeded'],
        [evaluationIds.second, 2, 'succeeded'],
        [evaluationIds.failed, 3, 'failed'],
      ]);
      const [first] = detail.evaluations;
      expect(first).toMatchObject({
        judge: 'mock/mock-judge',
        rubricVersion: '0.1-test',
        templateVersion: 'v1',
        totalScore: 65,
        error: null,
      });
      // Veritabanına ozgun, imge, ritim sırasıyla yazıldı; rubrik sırası imge, ritim, ozgun.
      expect(first!.scores).toEqual([
        { key: 'imge', label: 'İmge', score: 5, comment: 'imge gerekçesi' },
        { key: 'ritim', label: 'Ritim', score: 3, comment: null },
        { key: 'ozgun', label: 'Özgünlük', score: 1, comment: 'özgünlük gerekçesi' },
      ]);
    });

    it('ayrıntı: başarısız puanlamada puan satırı yok, hata mesajı var', async () => {
      const failed = (await library.get(ids.claude))!.evaluations[2]!;
      expect(failed).toMatchObject({
        status: 'failed',
        totalScore: null,
        scores: [],
        error: 'hakem geçersiz cevap verdi',
      });
    });

    it('ayrıntı: elle girilen metinde üretim kaydı ve yazar yok, puanlama listesi boş', async () => {
      const detail = (await library.get(ids.manual))!;
      expect(detail).toMatchObject({
        author: null,
        generation: null,
        evaluations: [],
        label: 'ChatGPT',
      });
    });

    it('olmayan kimlik için null döner', async () => {
      expect(await library.get(ids.manual + 1000)).toBeNull();
    });
  });
}
