import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/lib/prisma.js';
import { PrismaExportRepository } from '../src/repositories/prisma-export.repository.js';
import { cleanRubricData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  afterAll(async () => {
    await cleanRubricData(db);
    await db.$disconnect();
  });

  describe('MySQL: dışa aktarma sorgusu', () => {
    const repo = new PrismaExportRepository(db);

    beforeEach(async () => {
      await cleanRubricData(db);
      const model = await db.providerModel.create({
        data: { provider: 'openai', modelId: 'gpt-x', displayName: 'GPT X' },
      });
      const genTemplate = await db.promptTemplate.create({
        data: { kind: 'generate', version: 'g1', body: 'üret' },
      });
      const judgeTemplate = await db.promptTemplate.create({
        data: { kind: 'judge', version: 'j1', body: 'puanla' },
      });
      const generation = await db.generation.create({
        data: {
          providerModelId: model.id,
          promptTemplateId: genTemplate.id,
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
          body: 'Üretilen şiir',
          source: 'generated',
          generationId: generation.id,
        },
      });
      const manual = await db.text.create({
        data: {
          genre: 'siir',
          theme: 'Deniz',
          body: 'Elle şiir',
          source: 'manual',
          label: 'Elle girilen',
        },
      });
      const rubric = await db.rubric.create({
        data: {
          genre: 'siir',
          version: '0.1-taslak',
          status: 'active',
          scaleMin: 1,
          scaleMax: 5,
          sourceNote: 'GEÇİCİ TASLAK: uzman doğrulaması yok.',
        },
      });
      const base = { rubricId: rubric.id, evaluatorType: 'llm' as const };

      await db.evaluation.create({
        data: {
          ...base,
          textId: generated.id,
          promptTemplateId: judgeTemplate.id,
          evaluatorRef: 'openai/gpt-x',
          status: 'succeeded',
          totalScore: 62.5,
          rawResponse: {
            usage: { inputTokens: 100, outputTokens: 50, latencyMs: 1234 },
            attempts: 2,
          },
          scores: {
            create: [
              { criterionKey: 'imge', score: 4, comment: 'iyi' },
              { criterionKey: 'ritim', score: 3, comment: null },
            ],
          },
        },
      });
      await db.evaluation.create({
        data: {
          ...base,
          textId: generated.id,
          promptTemplateId: judgeTemplate.id,
          evaluatorRef: 'google/gemini-y',
          status: 'failed',
          error: 'server_error: HTTP 503',
          rawResponse: { attempts: 1, latencyMs: 900 },
        },
      });
      await db.evaluation.create({
        data: {
          ...base,
          textId: manual.id,
          evaluatorRef: 'anthropic/claude-z',
          status: 'succeeded',
          totalScore: 50,
          scores: { create: [{ criterionKey: 'imge', score: 3, comment: null }] },
        },
      });
    });

    it('tüm puanlamaları kimlik sırasıyla, metin, yazar, rubrik, komut sürümü ve kullanımla döner', async () => {
      const [first, second, third] = await repo.listEvaluations();
      expect(first).toEqual({
        evaluationId: expect.any(Number),
        textId: expect.any(Number),
        genre: 'siir',
        theme: 'Sonbahar',
        textBody: 'Üretilen şiir',
        author: { provider: 'openai', modelId: 'gpt-x' },
        label: null,
        judge: 'openai/gpt-x',
        replicateNo: 1,
        status: 'succeeded',
        error: null,
        totalScore: 62.5,
        rubricVersion: '0.1-taslak',
        rubricNote: 'GEÇİCİ TASLAK: uzman doğrulaması yok.',
        judgeTemplateVersion: 'j1',
        generationTemplateVersion: 'g1',
        attempts: 2,
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 1234,
        scores: [
          { criterionKey: 'imge', score: 4, comment: 'iyi' },
          { criterionKey: 'ritim', score: 3, comment: null },
        ],
      });
      expect(second?.evaluationId).toBeGreaterThan(first?.evaluationId ?? 0);
      expect(third?.evaluationId).toBeGreaterThan(second?.evaluationId ?? 0);
    });

    it('başarısız puanlama: hata ve süre var, puan yok, token yok', async () => {
      const second = (await repo.listEvaluations())[1];
      expect(second).toMatchObject({
        judge: 'google/gemini-y',
        status: 'failed',
        error: 'server_error: HTTP 503',
        totalScore: null,
        scores: [],
        attempts: 1,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 900,
      });
    });

    it('elle girilen metin: yazar yok, etiket var; komut sürümü ve kullanım bilgisi boş', async () => {
      const third = (await repo.listEvaluations())[2];
      expect(third).toMatchObject({
        textBody: 'Elle şiir',
        author: null,
        label: 'Elle girilen',
        judgeTemplateVersion: null,
        generationTemplateVersion: null,
        attempts: null,
        inputTokens: null,
        latencyMs: null,
        scores: [{ criterionKey: 'imge', score: 3, comment: null }],
      });
    });
  });
}
