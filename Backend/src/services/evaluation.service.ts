import { z } from 'zod';
import { estimateCostUsd } from '../domain/model-params.js';
import { AppError } from '../lib/errors.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { withResilience, type ResilienceOptions } from '../providers/resilient-provider.js';
import type { EvaluationRepository } from '../repositories/evaluation.repository.js';
import type { ProviderModelRepository } from '../repositories/provider-model.repository.js';
import { judgeText, type JudgedCriterion, type JudgeOutcome } from './judge.service.js';
import type { PromptTemplateService } from './prompt-template.service.js';
import type { RubricService } from './rubric.service.js';

/** Model ayarında yoksa kullanılan değer. Düşünen modeller yavaş olabildiği için geniş (ADR 0010). */
const DEFAULT_TIMEOUT_MS = 120_000;

const requestSchema = z.strictObject({
  textId: z.number().int().positive(),
  judgeModelId: z.number().int().positive(),
  /** Aynı metni aynı hakemle tekrar puanlamak için (kararlılık ölçümü); her tekrar ayrı kayıt olur. */
  replicateNo: z.number().int().min(1).max(20).default(1),
});

export type EvaluationResult =
  | {
      evaluationId: number;
      status: 'succeeded';
      /** Ağırlıklı toplam, 0-100. */
      totalScore: number;
      scores: JudgedCriterion[];
      attempts: number;
      /** Başarılı çağrının token sayıları (yeniden denenen bozuk cevabınki sağlayıcıdan gelmez, dahil değil). */
      inputTokens: number;
      outputTokens: number;
      /** Gerçek maliyet (dolar): tokenler × model fiyatı. Fiyat bilinmiyorsa boş. */
      costUsd: number | null;
    }
  | {
      evaluationId: number;
      status: 'failed';
      error: string;
      attempts: number;
      inputTokens: null;
      outputTokens: null;
      costUsd: null;
    };

export interface EvaluationService {
  evaluate(raw: unknown): Promise<EvaluationResult>;
}

export interface EvaluationDeps {
  evaluations: EvaluationRepository;
  models: ProviderModelRepository;
  templates: PromptTemplateService;
  rubrics: RubricService;
  providers: ProviderRegistry;
  /** Yeniden deneme ayarları (testlerde bekleme atlanır). Süre sınırı hakem modelin ayarından gelir. */
  resilience?: ResilienceOptions;
}

/**
 * Bir metni, etkin rubrikle, seçilen hakem modele puanlatır ve sonucu kayıt defterine yazar.
 * Başarısız hakem `failed` olarak kalır, puan yazılmaz (ADR 0004). Toplu çalıştırma ve ilerleme
 * F2'deki iş kuyruğunda bunun üzerine kurulur.
 */
export function createEvaluationService(deps: EvaluationDeps): EvaluationService {
  return {
    async evaluate(raw) {
      const request = requestSchema.parse(raw);

      // Hiçbir kayıt açılmadan ve çağrı yapılmadan önce her şey doğrulanır: para harcayan iş yarım başlamasın.
      const text = await deps.evaluations.findText(request.textId);
      if (!text) throw AppError.notFound(`Metin bulunamadı: ${request.textId}`);
      const [model] = await deps.models.findByIds([request.judgeModelId]);
      if (!model?.active) {
        throw AppError.notFound(
          `Hakem model kullanılamıyor (yok ya da kapalı): ${request.judgeModelId}`,
        );
      }
      const provider = deps.providers.get(model.provider);
      const template = await deps.templates.getLatest('judge');
      const rubric = await deps.rubrics.getActiveRubric(text.genre);

      // Hakeme bu rubrikle sorulacak: içeriği artık kilitlenir (ADR 0003), çağrı başarısız olsa da.
      await deps.rubrics.markUsed(rubric.id);
      const evaluationId = await deps.evaluations.start({
        textId: text.id,
        rubricId: rubric.id,
        promptTemplateId: template.id,
        evaluatorRef: `${model.provider}/${model.modelId}`,
        replicateNo: request.replicateNo,
      });
      const versions = { templateVersion: template.version, rubricVersion: rubric.version };

      let judged: JudgeOutcome;
      try {
        judged = await judgeText(
          withResilience(provider, {
            ...deps.resilience,
            timeoutMs: model.params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          }),
          {
            template,
            rubric,
            genre: text.genre,
            theme: text.theme,
            text: text.body,
            model: model.modelId,
            ...(model.params.maxTokens !== undefined && { maxTokens: model.params.maxTokens }),
          },
        );
      } catch (error) {
        // Beklenmeyen hata (kod hatası): kayıt "çalışıyor" diye takılı kalmasın, hata görünür kalsın.
        const detail = error instanceof Error ? error.message : String(error);
        await deps.evaluations
          .fail(evaluationId, { error: `beklenmeyen hata: ${detail}` })
          .catch(() => undefined);
        throw error;
      }

      try {
        if (judged.status === 'failed') {
          await deps.evaluations.fail(evaluationId, {
            error: judged.error,
            rawResponse: { attempts: judged.attempts, latencyMs: judged.latencyMs, ...versions },
          });
          return {
            evaluationId,
            status: 'failed',
            error: judged.error,
            attempts: judged.attempts,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
          };
        }
        await deps.evaluations.succeed(evaluationId, {
          totalScore: judged.total,
          scores: judged.scores.map(({ key, score, comment }) => ({ key, score, comment })),
          rawResponse: {
            // Doğrulanmış ham cevap: modelin verdiği puan ve gerekçeler.
            answer: {
              puanlar: Object.fromEntries(
                judged.scores.map((s) => [s.key, { puan: s.score, gerekce: s.comment }]),
              ),
            },
            usage: {
              inputTokens: judged.inputTokens,
              outputTokens: judged.outputTokens,
              latencyMs: judged.latencyMs,
            },
            attempts: judged.attempts,
            ...versions,
          },
        });
        return {
          evaluationId,
          status: 'succeeded',
          totalScore: judged.total,
          scores: judged.scores,
          attempts: judged.attempts,
          inputTokens: judged.inputTokens,
          outputTokens: judged.outputTokens,
          costUsd:
            estimateCostUsd(
              judged.inputTokens,
              judged.outputTokens,
              model.params.priceUsdPerMillion,
            ) ?? null,
        };
      } catch (error) {
        // Kayıt yazılamadı (veritabanı hatası): takılı kalmasın, hata yukarı atılsın.
        const detail = error instanceof Error ? error.message : String(error);
        await deps.evaluations
          .fail(evaluationId, { error: `kayıt hatası: ${detail}` })
          .catch(() => undefined);
        throw error;
      }
    },
  };
}
