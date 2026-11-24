import { z } from 'zod';
import { GENRES, type Genre } from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type {
  ProviderModelRecord,
  ProviderModelRepository,
} from '../repositories/provider-model.repository.js';
import type { TextRepository } from '../repositories/text.repository.js';
import type { EvaluationService } from './evaluation.service.js';
import type { JudgedCriterion } from './judge.service.js';
import type { RubricService } from './rubric.service.js';

// 20000 karakter: OpenAPI'deki metin sınırı. 2-3 metin: Karşılaştır sayfasının sözleşmesi.
const requestSchema = z.strictObject({
  genre: z.enum(GENRES, { error: 'Tür siir, hikaye ya da deneme olmalı (Türkçe karakter yok)' }),
  theme: z.string().trim().min(1, 'Tema boş olamaz').max(32),
  items: z
    .array(
      z.strictObject({
        label: z.string().trim().max(128).optional(),
        body: z.string().trim().min(1, 'Metin boş olamaz').max(20_000),
      }),
    )
    .min(2, 'En az iki metin gerekir')
    .max(3, 'En çok üç metin karşılaştırılır'),
});

export type ComparisonItem =
  | {
      label: string | null;
      textId: number;
      status: 'succeeded';
      /** Ağırlıklı toplam, 0-100. */
      totalScore: number;
      scores: JudgedCriterion[];
      costUsd: number | null;
    }
  | { label: string | null; textId: number; status: 'failed'; error: string };

export interface ComparisonResult {
  genre: Genre;
  theme: string;
  /** Puanlayan hakem, `sağlayıcı/model` biçiminde. Metinlere yalnızca tür, tema ve metin gider (kör). */
  judge: string;
  rubric: {
    id: number;
    version: string;
    scale: { min: number; max: number };
    criteria: { key: string; label: string; weight: number }[];
  };
  /** İstek sırasıyla. */
  items: ComparisonItem[];
  /** Başarılı çağrıların toplam maliyeti (dolar); hiçbirinin fiyatı bilinmiyorsa boş. */
  totalCostUsd: number | null;
}

export interface ComparisonService {
  compare(raw: unknown): Promise<ComparisonResult>;
}

export interface ComparisonDeps {
  texts: TextRepository;
  evaluation: EvaluationService;
  models: ProviderModelRepository;
  rubrics: RubricService;
  providers: ProviderRegistry;
  /** Hakem modelin adı (örn. `deepseek-flash`); sistemin tek sabit hakemi (ADR 0011). */
  judgeModel: string;
}

async function resolveJudge(deps: ComparisonDeps): Promise<ProviderModelRecord> {
  const matches = (await deps.models.findByModelIds([deps.judgeModel])).filter(
    (m) => m.modelId === deps.judgeModel,
  );
  if (matches.length !== 1 || !matches[0]!.active) {
    throw AppError.unavailable(
      `Hakem model kullanılamıyor: ${deps.judgeModel} (kayıtlı, tek ve açık olmalı; npm run db:seed)`,
    );
  }
  return matches[0]!;
}

/**
 * Üç metni yan yana puanlatır: metinler "elle girilen" olarak kaydedilir (model analizine girmez), her biri
 * sabit hakemle ayrı puanlanır. Hakem model adını görmez. Para harcanmadan ve kayıt açılmadan önce hakem,
 * sağlayıcı anahtarı ve etkin rubrik doğrulanır.
 */
export function createComparisonService(deps: ComparisonDeps): ComparisonService {
  return {
    async compare(raw) {
      const request = requestSchema.parse(raw);

      const judge = await resolveJudge(deps);
      deps.providers.get(judge.provider);
      // shortcut: rubrik burada okunur, puanlamada servis etkin rubriği yeniden okur; iki okuma arasında
      // yönetici rubriği değiştirirse ekrandaki kriter adları kayar. Rubrik yönetimi F4'te (giriş) açılır.
      const rubric = await deps.rubrics.getActiveRubric(request.genre);

      const textIds = await deps.texts.createManual(
        request.items.map((item) => ({
          genre: request.genre,
          theme: request.theme,
          body: item.body,
          label: item.label || null,
        })),
      );

      // Biri başarısız olsa da diğerlerinin sonucu kaybolmasın: hepsi bitince bakılır.
      const settled = await Promise.allSettled(
        textIds.map((textId) => deps.evaluation.evaluate({ textId, judgeModelId: judge.id })),
      );
      const crashed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
      if (crashed) throw crashed.reason;

      const items = settled.map((s, i): ComparisonItem => {
        const result = (
          s as PromiseFulfilledResult<Awaited<ReturnType<EvaluationService['evaluate']>>>
        ).value;
        const base = { label: request.items[i]!.label || null, textId: textIds[i]! };
        return result.status === 'succeeded'
          ? {
              ...base,
              status: 'succeeded',
              totalScore: result.totalScore,
              scores: result.scores,
              costUsd: result.costUsd,
            }
          : { ...base, status: 'failed', error: result.error };
      });

      const costs = items.flatMap((i) =>
        i.status === 'succeeded' && i.costUsd !== null ? [i.costUsd] : [],
      );
      return {
        genre: request.genre,
        theme: request.theme,
        judge: `${judge.provider}/${judge.modelId}`,
        rubric: {
          id: rubric.id,
          version: rubric.version,
          scale: rubric.scale,
          criteria: rubric.criteria.map(({ key, label, weight }) => ({ key, label, weight })),
        },
        items,
        totalCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      };
    },
  };
}
