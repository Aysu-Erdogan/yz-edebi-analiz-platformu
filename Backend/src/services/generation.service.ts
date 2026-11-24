import { z } from 'zod';
import { estimateCostUsd } from '../domain/model-params.js';
import { generationVars, renderPrompt } from '../domain/prompt.js';
import { GENRES } from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import { ProviderError, estimateTokens } from '../providers/provider.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { withResilience, type ResilienceOptions } from '../providers/resilient-provider.js';
import type { GenerationRepository } from '../repositories/generation.repository.js';
import type { ProviderModelRepository } from '../repositories/provider-model.repository.js';
import type { PromptTemplateService } from './prompt-template.service.js';

/** Model ayarında yoksa kullanılan değerler. Düşünen modeller yavaş olabildiği için süre geniş (ADR 0010). */
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;

const requestSchema = z
  .strictObject({
    genre: z.enum(GENRES),
    theme: z.string(), // geçerliliğini generationVars denetler (tek satır, en çok 32 karakter)
    modelIds: z.array(z.number().int().positive()).min(1).max(20),
    replicates: z.number().int().min(1).max(10).default(1),
    /** İlk tekrar numarası: toplu iş yeniden başlayınca kaldığı tekrardan devam edebilsin (varsayılan 1). */
    firstReplicateNo: z.number().int().min(1).default(1),
    /** Tahmini maliyet bunu aşacaksa hiçbir çağrı yapılmadan reddedilir (T12). */
    maxCostUsd: z.number().positive().optional(),
    /** Yalnızca tahmin verir: çağrı ve kayıt yok. */
    dryRun: z.boolean().default(false),
  })
  .refine((r) => new Set(r.modelIds).size === r.modelIds.length, {
    path: ['modelIds'],
    message: 'Model kimlikleri tekrar edemez',
  });

export interface GenerationOutcome {
  generationId: number;
  providerModelId: number;
  replicateNo: number;
  status: 'succeeded' | 'failed';
  textId: number | null;
  error: string | null;
  /** Sağlayıcının bildirdiği token sayıları; başarısız çağrıda boş. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Gerçek maliyet (dolar): tokenler × model fiyatı. Fiyat bilinmiyorsa ya da çağrı başarısızsa boş. */
  costUsd: number | null;
}

export interface GenerationRunResult {
  dryRun: boolean;
  templateId: number;
  templateVersion: string;
  /** Her modele giden, doldurulmuş soru (hepsine aynı). */
  prompt: string;
  /** En kötü durum tahmini: çıktının tam token sınırı kadar olduğu varsayılır. */
  estimatedCostUsd: number;
  /** Fiyatı bilinmeyen modeller (tahmine katılmaz). */
  unpricedModels: string[];
  outcomes: GenerationOutcome[];
  succeeded: number;
  failed: number;
}

export interface GenerationService {
  generate(raw: unknown): Promise<GenerationRunResult>;
}

export interface GenerationDeps {
  models: ProviderModelRepository;
  generations: GenerationRepository;
  templates: PromptTemplateService;
  providers: ProviderRegistry;
  /** Yeniden deneme ayarları (testlerde bekleme atlanır). Süre sınırı model ayarından gelir. */
  resilience?: ResilienceOptions;
}

/**
 * Metin üretimi: aynı soruyu (en son üretim şablonundan doldurulmuş) seçilen modellere sırayla sorar,
 * her çağrıyı kayıt defterine yazar. Bir modelin hatası diğerlerini durdurmaz (T09); hatalı çağrı için
 * metin uydurulmaz (ADR 0004). Toplu çalıştırma ve ilerleme F2'deki iş kuyruğunda bunun üzerine kurulur.
 */
export function createGenerationService(deps: GenerationDeps): GenerationService {
  return {
    async generate(raw) {
      const request = requestSchema.parse(raw);
      const vars = generationVars(request.genre, request.theme);

      // Hiçbir çağrı yapılmadan önce her şey doğrulanır: para harcayan iş yarım başlamasın.
      const found = await deps.models.findByIds(request.modelIds);
      const byId = new Map(found.map((m) => [m.id, m]));
      const unusable = request.modelIds.filter((id) => !byId.get(id)?.active);
      if (unusable.length > 0) {
        throw AppError.notFound(
          `Kullanılamayan model kimlikleri (yok ya da kapalı): ${unusable.join(', ')}`,
        );
      }
      const models = request.modelIds.map((id) => byId.get(id)!);

      const template = await deps.templates.getLatest('generate');
      const prompt = renderPrompt(template.body, vars); // bir kez doldurulur: hepsine aynı soru (T11)
      const providers = models.map((m) => deps.providers.get(m.provider));

      const inputTokens = estimateTokens(prompt);
      let estimatedCostUsd = 0;
      const unpricedModels: string[] = [];
      for (const model of models) {
        const perCall = estimateCostUsd(
          inputTokens,
          model.params.maxTokens ?? DEFAULT_MAX_TOKENS,
          model.params.priceUsdPerMillion,
        );
        if (perCall === undefined) unpricedModels.push(model.modelId);
        else estimatedCostUsd += perCall * request.replicates;
      }
      if (request.maxCostUsd !== undefined) {
        if (unpricedModels.length > 0) {
          throw AppError.validation(
            `Fiyat bilgisi olmayan model varken maliyet sınırı garanti edilemez: ${unpricedModels.join(', ')}`,
          );
        }
        if (estimatedCostUsd > request.maxCostUsd) {
          throw AppError.validation(
            `Tahmini maliyet ($${estimatedCostUsd.toFixed(4)}) sınırı ($${request.maxCostUsd}) aşıyor: hiçbir çağrı yapılmadı`,
            { estimatedCostUsd, maxCostUsd: request.maxCostUsd },
          );
        }
      }

      const result: GenerationRunResult = {
        dryRun: request.dryRun,
        templateId: template.id,
        templateVersion: template.version,
        prompt,
        estimatedCostUsd,
        unpricedModels,
        outcomes: [],
        succeeded: 0,
        failed: 0,
      };
      if (request.dryRun) return result;

      for (const [index, model] of models.entries()) {
        const maxTokens = model.params.maxTokens ?? DEFAULT_MAX_TOKENS;
        const timeoutMs = model.params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const provider = withResilience(providers[index]!, { ...deps.resilience, timeoutMs });

        for (
          let replicateNo = request.firstReplicateNo;
          replicateNo < request.firstReplicateNo + request.replicates;
          replicateNo++
        ) {
          const generationId = await deps.generations.start({
            providerModelId: model.id,
            promptTemplateId: template.id,
            genre: request.genre,
            theme: vars.tema as string,
            replicateNo,
            params: { vars, maxTokens, timeoutMs, templateVersion: template.version },
          });
          const started = Date.now();
          const outcome = { generationId, providerModelId: model.id, replicateNo };
          try {
            const answer = await provider.generateText({ model: model.modelId, prompt, maxTokens });
            const textId = await deps.generations.succeed(generationId, {
              genre: request.genre,
              theme: vars.tema as string,
              body: answer.text,
              inputTokens: answer.inputTokens,
              outputTokens: answer.outputTokens,
              latencyMs: Date.now() - started,
            });
            result.outcomes.push({
              ...outcome,
              status: 'succeeded',
              textId,
              error: null,
              inputTokens: answer.inputTokens,
              outputTokens: answer.outputTokens,
              costUsd:
                estimateCostUsd(
                  answer.inputTokens,
                  answer.outputTokens,
                  model.params.priceUsdPerMillion,
                ) ?? null,
            });
            result.succeeded++;
          } catch (error) {
            const latencyMs = Date.now() - started;
            if (error instanceof ProviderError) {
              // Sağlayıcı hatası: bu kayıt başarısız olur, diğer modeller sürer (T09).
              const message = `${error.kind}: ${error.message}`;
              await deps.generations.fail(generationId, { error: message, latencyMs });
              result.outcomes.push({
                ...outcome,
                status: 'failed',
                textId: null,
                error: message,
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
              });
              result.failed++;
              continue;
            }
            // Beklenmeyen hata (kod ya da veritabanı hatası): kayıt "çalışıyor" diye takılı kalmasın, hata görünür kalsın.
            const detail = error instanceof Error ? error.message : String(error);
            await deps.generations
              .fail(generationId, { error: `beklenmeyen hata: ${detail}`, latencyMs })
              .catch(() => undefined);
            throw error;
          }
        }
      }
      return result;
    },
  };
}
