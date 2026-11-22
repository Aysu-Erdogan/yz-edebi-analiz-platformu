import { z } from 'zod';
import { generationVars } from '../domain/prompt.js';
import { GENRES } from '../domain/rubric.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { GenerationRepository } from '../repositories/generation.repository.js';
import type { JobRepository, StoredJob } from '../repositories/job.repository.js';
import type {
  ProviderModelRecord,
  ProviderModelRepository,
} from '../repositories/provider-model.repository.js';
import type { GenerationService } from './generation.service.js';
import type { JobHandler } from './job-runner.js';
import type { PromptTemplateService } from './prompt-template.service.js';

/** İş türü adı (`jobs.type`, en çok 32 karakter). */
export const GENERATE_BATCH = 'generate_batch';

const baseShape = {
  /** Üretilecek (tür, tema) çiftleri. Her biri her modelle `replicates` kez üretilir. */
  topics: z
    .array(z.strictObject({ genre: z.enum(GENRES), theme: z.string() }))
    .min(1)
    .max(200),
  modelIds: z.array(z.number().int().positive()).min(1).max(20),
  replicates: z.number().int().min(1).max(10).default(1),
  /** Bu çalıştırmanın harcama sınırı (dolar). Dolunca iş durur, kalanlar yeni işle yapılır. */
  maxCostUsd: z.number().positive().optional(),
};

const unique = (
  value: { topics: { genre: string; theme: string }[]; modelIds: number[] },
  ctx: z.RefinementCtx,
) => {
  if (new Set(value.modelIds).size !== value.modelIds.length) {
    ctx.addIssue({ code: 'custom', path: ['modelIds'], message: 'Model kimlikleri tekrar edemez' });
  }
  const keys = value.topics.map((t) => `${t.genre}|${t.theme}`);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: 'custom', path: ['topics'], message: 'Aynı tür ve tema tekrar edemez' });
  }
};

const inputSchema = z.strictObject(baseShape).superRefine(unique);
/** Kuyrukta saklanan parametreler: şablon kimliği iş eklenirken sabitlenir. */
const payloadSchema = z
  .strictObject({ ...baseShape, templateId: z.number().int().positive() })
  .superRefine(unique);

export interface EnqueueGenerateBatchDeps {
  jobs: JobRepository;
  templates: PromptTemplateService;
}

/**
 * Toplu üretim işi ekler. En son üretim şablonu işe **sabitlenir**: iş sürerken şablon değişirse devam
 * edilmez, böylece bir veri setinin içinde iki farklı komutla üretilmiş metin karışmaz.
 */
export async function enqueueGenerateBatch(
  deps: EnqueueGenerateBatchDeps,
  raw: unknown,
): Promise<StoredJob> {
  const input = inputSchema.parse(raw);
  // Tema, üretim kaydındaki gibi kırpılmış hâliyle saklanır: biten öğeleri tanımak için aynı biçim gerekir.
  const topics = input.topics.map((t) => ({
    genre: t.genre,
    theme: generationVars(t.genre, t.theme).tema as string,
  }));
  const template = await deps.templates.getLatest('generate');
  return deps.jobs.enqueue({
    type: GENERATE_BATCH,
    payload: { ...input, topics, templateId: template.id },
    total: topics.length * input.modelIds.length * input.replicates,
  });
}

export interface GenerateBatchDeps {
  generation: GenerationService;
  generations: GenerationRepository;
  models: ProviderModelRepository;
  templates: PromptTemplateService;
  providers: ProviderRegistry;
}

interface Item {
  model: ProviderModelRecord;
  genre: (typeof GENRES)[number];
  theme: string;
  replicateNo: number;
}

const keyOf = (i: {
  providerModelId: number;
  genre: string;
  theme: string;
  replicateNo: number;
}): string => `${i.providerModelId}|${i.genre}|${i.theme}|${i.replicateNo}`;

/**
 * Toplu üretim işleyicisi. Öğe = (tür, tema, model, tekrar). Her sağlayıcı kendi şeridinde **sırayla** çalışır
 * (aynı sağlayıcıya aynı anda tek istek), şeritler **paralel**: yavaş bir sağlayıcı hızlıları bekletmez.
 * Biten öğeler (aynı şablonla başarıyla üretilmiş) atlanır, yeniden başlatma kaldığı yerden devam eder (T37).
 * Bir öğenin sağlayıcı hatası işi durdurmaz (T09); bütçe dolunca iş durur.
 */
export function createGenerateBatchHandler(deps: GenerateBatchDeps): JobHandler {
  return async (ctx) => {
    const payload = payloadSchema.parse(ctx.job.payload);

    // Tek işçi varsayımı: açılışta "çalışıyor" görünen üretim kaydı, çökmüş bir sürecin artığıdır.
    await deps.generations.failInterrupted('sunucu kapandı, yarım kaldı');

    // Hiçbir çağrı yapılmadan önce her şey doğrulanır: para harcayan iş yarım başlamasın.
    const template = await deps.templates.getLatest('generate');
    if (template.id !== payload.templateId) {
      return {
        status: 'failed',
        error: `Üretim komut şablonu iş eklendikten sonra değişti (işteki: ${payload.templateId}, şimdiki: ${template.id}); tutarlı veri için yeni iş ekleyin`,
      };
    }
    const found = await deps.models.findByIds(payload.modelIds);
    const byId = new Map(found.map((m) => [m.id, m]));
    const unusable = payload.modelIds.filter((id) => !byId.get(id)?.active);
    if (unusable.length > 0) {
      return {
        status: 'failed',
        error: `Kullanılamayan model kimlikleri (yok ya da kapalı): ${unusable.join(', ')}`,
      };
    }
    const models = payload.modelIds.map((id) => byId.get(id)!);
    for (const model of models) deps.providers.get(model.provider); // anahtarı yoksa 503 fırlatır
    if (payload.maxCostUsd !== undefined) {
      const unpriced = models.filter((m) => m.params.priceUsdPerMillion === undefined);
      if (unpriced.length > 0) {
        return {
          status: 'failed',
          error: `Fiyat bilgisi olmayan model varken bütçe garanti edilemez: ${unpriced.map((m) => m.modelId).join(', ')}`,
        };
      }
    }

    // Şeritler: sağlayıcı başına sıralı öğe listesi.
    const lanes = new Map<string, Item[]>();
    for (const model of models) {
      const lane = lanes.get(model.provider) ?? [];
      for (const topic of payload.topics) {
        for (let replicateNo = 1; replicateNo <= payload.replicates; replicateNo++) {
          lane.push({ model, genre: topic.genre, theme: topic.theme, replicateNo });
        }
      }
      lanes.set(model.provider, lane);
    }
    const finished = new Set(
      (
        await deps.generations.findSucceeded({
          promptTemplateId: payload.templateId,
          providerModelIds: payload.modelIds,
        })
      ).map(keyOf),
    );
    const isFinished = (item: Item) =>
      finished.has(
        keyOf({
          providerModelId: item.model.id,
          genre: item.genre,
          theme: item.theme,
          replicateNo: item.replicateNo,
        }),
      );

    let done = [...lanes.values()].flat().filter(isFinished).length;
    let failed = 0;
    let spent = 0; // shortcut: bütçe her çalıştırma için ayrı sayılır (çökme sonrası devamda sıfırdan), yeni işte de böyle
    let halt: 'budget' | 'error' | undefined;

    // Şeritler aynı anda yazar: yazmaları sıraya dizip her seferinde güncel sayaçları yazarız.
    let writes: Promise<void> = Promise.resolve();
    const report = () => (writes = writes.then(() => ctx.progress({ done, failed })));
    await report(); // yeniden başlatmada devam noktası hemen görünsün

    async function runLane(items: Item[]): Promise<void> {
      try {
        for (const item of items) {
          if (isFinished(item)) continue;
          if (ctx.signal.aborted || halt) return;
          const result = await deps.generation.generate({
            genre: item.genre,
            theme: item.theme,
            modelIds: [item.model.id],
            replicates: 1,
            firstReplicateNo: item.replicateNo,
          });
          const outcome = result.outcomes[0]!;
          if (outcome.status === 'succeeded') done++;
          else failed++;
          spent += outcome.costUsd ?? 0;
          if (payload.maxCostUsd !== undefined && spent >= payload.maxCostUsd) halt ??= 'budget';
          await report();
        }
      } catch (error) {
        halt = 'error'; // diğer şeritler yeni öğe almasın
        throw error;
      }
    }

    const settled = await Promise.allSettled([...lanes.values()].map(runLane));
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (rejected) throw rejected.reason; // kod/veritabanı hatası: iş failed olur, neden yazılır
    if (ctx.signal.aborted) return { status: 'interrupted' };
    if (halt === 'budget') {
      return {
        status: 'failed',
        error: `Bütçe doldu: harcanan $${spent.toFixed(4)} (sınır $${payload.maxCostUsd}); ${done}/${ctx.job.total} öğe tamam. Aynı parametrelerle yeni iş eklerseniz kalanlar yapılır, biten öğeler atlanır.`,
      };
    }
    return { status: 'done', result: { done, failed, spentUsd: spent } };
  };
}
