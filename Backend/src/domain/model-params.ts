import { z } from 'zod';

/**
 * Bir modelin varsayılan çağrı ayarları (provider_models.default_params). Hepsi isteğe bağlı,
 * bilinmeyen anahtarlar korunur. Sıcaklık yoktur: yeni modeller onu reddediyor ya da yok sayıyor (ADR 0010).
 */
export const modelParamsSchema = z.looseObject({
  /** Çıktı token sınırı (düşünen modellerde düşünme tokenleri de buna dahildir). */
  maxTokens: z.number().int().positive().optional(),
  /** Tek bir denemenin süre sınırı (milisaniye). Yavaş modeller için uzun tutulur. */
  timeoutMs: z.number().int().positive().optional(),
  /** Milyon token başına dolar; maliyet tahmini için. */
  priceUsdPerMillion: z
    .strictObject({ input: z.number().min(0), output: z.number().min(0) })
    .optional(),
});
export type ModelParams = z.infer<typeof modelParamsSchema>;

/** Maliyet tahmini (dolar). Fiyat bilinmiyorsa tanımsız: sıfır sanılmasın. */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  price: ModelParams['priceUsdPerMillion'],
): number | undefined {
  if (!price) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}
