import { judgeOutputSchema, judgeVars, weightedTotal, type JudgeRubric } from '../domain/judge.js';
import { renderPrompt } from '../domain/prompt.js';
import type { Genre } from '../domain/rubric.js';
import { normalizeScore } from '../domain/scoring.js';
import { ProviderError, type LLMProvider } from '../providers/provider.js';

/** Düşünen modellerde düşünme tokenleri de sınıra dahildir; çıktı kısa olsa bile geniş tutulur. */
const DEFAULT_MAX_TOKENS = 4096;
/** Bozuk cevapta toplam deneme sayısı: ilk deneme + bir yeniden deneme (T14). */
const MAX_ATTEMPTS = 2;

export interface JudgeInput {
  /** Yargıç komut şablonu (en son sürüm); kayıt defterine sürümü yazılır. */
  template: { version: string; body: string };
  rubric: JudgeRubric;
  genre: Genre;
  theme: string;
  /** Yalnızca metnin kendisi: metni yazan modelin adı buraya verilmez (kör değerlendirme, T19). */
  text: string;
  /** Yargıç modelin sağlayıcıdaki kimliği. */
  model: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface JudgedCriterion {
  key: string;
  /** Yargıcın verdiği ham puan (ölçek içinde, tam sayı). */
  score: number;
  /** Ham puanın 0-100 karşılığı (ADR 0009). */
  normalized: number;
  comment: string;
}

export type JudgeOutcome =
  | {
      status: 'succeeded';
      scores: JudgedCriterion[];
      /** Ağırlıklı toplam, 0-100. */
      total: number;
      attempts: number;
      /** Başarılı çağrının token sayıları; yeniden denenen bozuk cevabın tokenleri sağlayıcıdan gelmez. */
      inputTokens: number;
      outputTokens: number;
      /** Tüm denemeler dahil toplam süre. */
      latencyMs: number;
    }
  | { status: 'failed'; error: string; attempts: number; latencyMs: number };

/**
 * Bir metni rubriğe göre yargıç modele puanlatır. Cevap şemayla doğrulanır; bozuk ya da geçersiz cevap
 * bir kez yeniden denenir, yine olmazsa `failed` döner: uydurma puan yazılmaz (T14, ADR 0004).
 *
 * Geçici sağlayıcı hataları (kota, 5xx, zaman aşımı) bu işlevin görevi değil: sağlayıcıyı çağıran
 * `withResilience` ile sarın. Kalıcı sağlayıcı hataları (yanlış anahtar gibi) yeniden denenmez.
 */
export async function judgeText(provider: LLMProvider, input: JudgeInput): Promise<JudgeOutcome> {
  if (input.rubric.genre !== input.genre) {
    throw new Error(
      `Rubrik türü (${input.rubric.genre}) ile metin türü (${input.genre}) uyuşmuyor`,
    );
  }
  const prompt = renderPrompt(input.template.body, judgeVars(input));
  const schema = judgeOutputSchema(input.rubric);
  const started = Date.now();
  let error = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await provider.generateJson({
        model: input.model,
        prompt,
        schema,
        maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(input.signal && { signal: input.signal }),
      });
      const raw = Object.fromEntries(
        Object.entries(result.data.puanlar).map(([key, value]) => [key, value.puan]),
      );
      return {
        status: 'succeeded',
        scores: input.rubric.criteria.map((criterion) => {
          const answer = result.data.puanlar[criterion.key]!;
          return {
            key: criterion.key,
            score: answer.puan,
            normalized: normalizeScore(answer.puan, input.rubric.scale),
            comment: answer.gerekce.trim(),
          };
        }),
        total: weightedTotal(input.rubric, raw),
        attempts: attempt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - started,
      };
    } catch (caught) {
      if (!(caught instanceof ProviderError)) throw caught; // kod hatası: görünür kalsın
      error = `${caught.kind}: ${caught.message}`;
      // Yalnızca bozuk/şemaya uymayan cevap yeniden denenir; diğer hatalar tekrarlansa da aynı çıkar.
      if (caught.kind !== 'invalid_output') {
        return { status: 'failed', error, attempts: attempt, latencyMs: Date.now() - started };
      }
    }
  }
  return { status: 'failed', error, attempts: MAX_ATTEMPTS, latencyMs: Date.now() - started };
}
