import { z } from 'zod';
import { GENRES } from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { EvaluationRepository, TextAuthor } from '../repositories/evaluation.repository.js';
import type { JobRepository, StoredJob } from '../repositories/job.repository.js';
import type { ProviderModelRepository } from '../repositories/provider-model.repository.js';
import { runBatchLanes, type BatchItem } from './batch-lanes.js';
import type { EvaluationService } from './evaluation.service.js';
import type { JobHandler } from './job-runner.js';
import type { PromptTemplateService } from './prompt-template.service.js';
import type { RubricService } from './rubric.service.js';

/** İş türü adı (`jobs.type`, en çok 32 karakter). */
export const EVALUATE_BATCH = 'evaluate_batch';

const baseShape = {
  textIds: z.array(z.number().int().positive()).min(1).max(5000),
  judgeModelIds: z.array(z.number().int().positive()).min(1).max(20),
  replicates: z.number().int().min(1).max(10).default(1),
  /**
   * `true` ise bir hakem, kendi ailesinin (sağlayıcısının) ürettiği metni puanlamaz. Varsayılan `false`: herkes
   * puanlar, kendi-puanı analizde ayrıca işaretlenir; böylece her metnin hakem takımı aynı kalır ve hakem sertliği
   * model farkıyla karışmaz (hakem smoke'ta hakemlerin sertliği çok farklı çıktı).
   */
  excludeSelf: z.boolean().default(false),
  /** Bu çalıştırmanın harcama sınırı (dolar). Dolunca iş durur, kalanlar yeni işle yapılır. */
  maxCostUsd: z.number().positive().optional(),
};

const unique = (value: { textIds: number[]; judgeModelIds: number[] }, ctx: z.RefinementCtx) => {
  if (new Set(value.textIds).size !== value.textIds.length) {
    ctx.addIssue({ code: 'custom', path: ['textIds'], message: 'Metin kimlikleri tekrar edemez' });
  }
  if (new Set(value.judgeModelIds).size !== value.judgeModelIds.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['judgeModelIds'],
      message: 'Hakem model kimlikleri tekrar edemez',
    });
  }
};

const inputSchema = z.strictObject(baseShape).superRefine(unique);
/** Kuyrukta saklanan parametreler: hakem şablonu ve her türün rubriği iş eklenirken sabitlenir. */
const payloadSchema = z
  .strictObject({
    ...baseShape,
    templateId: z.number().int().positive(),
    rubrics: z
      .array(z.strictObject({ genre: z.enum(GENRES), rubricId: z.number().int().positive() }))
      .min(1),
  })
  .superRefine(unique);

/** Aynı aile (sağlayıcı) mı? Yazarı bilinmeyen (elle girilen) metinde kimse dışlanmaz. */
const isSelf = (author: TextAuthor | undefined, judgeProvider: string): boolean =>
  author !== undefined && author.provider === judgeProvider;

export interface EnqueueEvaluateBatchDeps {
  jobs: JobRepository;
  evaluations: EvaluationRepository;
  models: ProviderModelRepository;
  templates: PromptTemplateService;
  rubrics: RubricService;
}

/**
 * Toplu puanlama işi ekler. En son hakem şablonu ve her türün etkin rubriği işe **sabitlenir**: iş sürerken
 * değişirse devam edilmez, böylece bir puan kümesinde iki farklı komut ya da cetvel karışmaz.
 */
export async function enqueueEvaluateBatch(
  deps: EnqueueEvaluateBatchDeps,
  raw: unknown,
): Promise<StoredJob> {
  const input = inputSchema.parse(raw);

  const texts = await deps.evaluations.findTexts(input.textIds);
  const missingTexts = input.textIds.filter((id) => !texts.some((t) => t.id === id));
  if (missingTexts.length > 0) {
    throw AppError.notFound(`Metin bulunamadı: ${missingTexts.join(', ')}`);
  }
  const judges = await deps.models.findByIds(input.judgeModelIds);
  const missingJudges = input.judgeModelIds.filter(
    (id) => !judges.some((m) => m.id === id && m.active),
  );
  if (missingJudges.length > 0) {
    throw AppError.notFound(
      `Hakem model kullanılamıyor (yok ya da kapalı): ${missingJudges.join(', ')}`,
    );
  }
  const template = await deps.templates.getLatest('judge');
  const rubrics = [];
  for (const genre of [...new Set(texts.map((t) => t.genre))]) {
    rubrics.push({ genre, rubricId: (await deps.rubrics.getActiveRubric(genre)).id });
  }

  const authors = input.excludeSelf
    ? new Map((await deps.evaluations.findAuthors(input.textIds)).map((a) => [a.textId, a]))
    : new Map<number, TextAuthor>();
  const pairs = texts.flatMap((text) =>
    judges.filter((judge) => !(input.excludeSelf && isSelf(authors.get(text.id), judge.provider))),
  ).length;

  return deps.jobs.enqueue({
    type: EVALUATE_BATCH,
    payload: { ...input, templateId: template.id, rubrics },
    total: pairs * input.replicates,
  });
}

export interface EvaluateBatchDeps {
  evaluation: EvaluationService;
  evaluations: EvaluationRepository;
  models: ProviderModelRepository;
  templates: PromptTemplateService;
  rubrics: RubricService;
  providers: ProviderRegistry;
}

/**
 * Toplu puanlama işleyicisi. Öğe = (metin, hakem model, tekrar). Her sağlayıcı kendi şeridinde sırayla, şeritler
 * paralel; biten öğeler atlanır (T37); bir hakemin hatası yalnızca o öğeyi `failed` yapar; bütçe dolunca iş durur.
 * Hakeme metnin yazarı söylenmez (kör); yazar bilgisi yalnızca `excludeSelf` için kullanılır.
 */
export function createEvaluateBatchHandler(deps: EvaluateBatchDeps): JobHandler {
  return async (ctx) => {
    const payload = payloadSchema.parse(ctx.job.payload);

    // Tek işçi varsayımı: açılışta "çalışıyor" görünen puanlama kaydı, çökmüş bir sürecin artığıdır.
    await deps.evaluations.failInterrupted('sunucu kapandı, yarım kaldı');

    // Hiçbir çağrı yapılmadan önce her şey doğrulanır: para harcayan iş yarım başlamasın.
    const template = await deps.templates.getLatest('judge');
    if (template.id !== payload.templateId) {
      return {
        status: 'failed',
        error: `Hakem komut şablonu iş eklendikten sonra değişti (işteki: ${payload.templateId}, şimdiki: ${template.id}); tutarlı puanlar için yeni iş ekleyin`,
      };
    }
    for (const { genre, rubricId } of payload.rubrics) {
      const active = await deps.rubrics.getActiveRubric(genre);
      if (active.id !== rubricId) {
        return {
          status: 'failed',
          error: `Etkin rubrik iş eklendikten sonra değişti (${genre}: işteki ${rubricId}, şimdiki ${active.id}); tutarlı puanlar için yeni iş ekleyin`,
        };
      }
    }
    const found = await deps.models.findByIds(payload.judgeModelIds);
    const byId = new Map(found.map((m) => [m.id, m]));
    const unusable = payload.judgeModelIds.filter((id) => !byId.get(id)?.active);
    if (unusable.length > 0) {
      return {
        status: 'failed',
        error: `Kullanılamayan hakem model kimlikleri (yok ya da kapalı): ${unusable.join(', ')}`,
      };
    }
    const judges = payload.judgeModelIds.map((id) => byId.get(id)!);
    for (const judge of judges) deps.providers.get(judge.provider); // anahtarı yoksa 503 fırlatır
    if (payload.maxCostUsd !== undefined) {
      const unpriced = judges.filter((m) => m.params.priceUsdPerMillion === undefined);
      if (unpriced.length > 0) {
        return {
          status: 'failed',
          error: `Fiyat bilgisi olmayan model varken bütçe garanti edilemez: ${unpriced.map((m) => m.modelId).join(', ')}`,
        };
      }
    }
    const texts = await deps.evaluations.findTexts(payload.textIds);
    const missing = payload.textIds.filter((id) => !texts.some((t) => t.id === id));
    if (missing.length > 0) {
      return { status: 'failed', error: `Metin bulunamadı: ${missing.join(', ')}` };
    }
    const authors = payload.excludeSelf
      ? new Map((await deps.evaluations.findAuthors(payload.textIds)).map((a) => [a.textId, a]))
      : new Map<number, TextAuthor>();

    const finished = new Set(
      (
        await deps.evaluations.findSucceeded({
          promptTemplateId: payload.templateId,
          rubricIds: payload.rubrics.map((r) => r.rubricId),
          textIds: payload.textIds,
        })
      ).map((e) => `${e.textId}|${e.evaluatorRef}|${e.replicateNo}`),
    );

    // Öğeler: hakem sırasıyla, her hakem kendi sağlayıcısının şeridinde metinleri sırayla puanlar.
    const items: BatchItem[] = [];
    for (const judge of judges) {
      const evaluatorRef = `${judge.provider}/${judge.modelId}`;
      for (const textId of payload.textIds) {
        if (payload.excludeSelf && isSelf(authors.get(textId), judge.provider)) continue;
        for (let replicateNo = 1; replicateNo <= payload.replicates; replicateNo++) {
          items.push({
            key: `${textId}|${evaluatorRef}|${replicateNo}`,
            lane: judge.provider,
            run: async () => {
              const result = await deps.evaluation.evaluate({
                textId,
                judgeModelId: judge.id,
                replicateNo,
              });
              return { succeeded: result.status === 'succeeded', costUsd: result.costUsd };
            },
          });
        }
      }
    }
    return runBatchLanes(ctx, items, finished, payload.maxCostUsd);
  };
}
