import { z } from 'zod';
import { generationVars } from './prompt.js';
import type { Genre, RubricInput } from './rubric.js';
import { normalizeScore } from './scoring.js';

/** Yargıcın ihtiyaç duyduğu rubrik parçası (kayıtlı rubrik de bu biçime uyar). */
export type JudgeRubric = Pick<RubricInput, 'genre' | 'scale' | 'criteria'>;

/** Metni saran etiketin sahtesi (açılış, kapanış, boşluklu, büyük/küçük harf ve Türkçe i varyantları). */
const FAKE_DELIMITER = /<\s*(\/?)\s*[mM][eE][tT][iıİI][nN]\s*>/g;

/**
 * Değerlendirilecek metin `<metin>` etiketiyle sarılır. Metnin içindeki sahte etiketler etkisizleştirilir:
 * yoksa metin bloğu erken kapatıp ardına talimat yazabilir (komut enjeksiyonu). Yalnızca etiket
 * biçimindeki parçalar değişir, metnin geri kalanına dokunulmaz.
 */
export function neutralizeText(text: string): string {
  return text.replace(FAKE_DELIMITER, (_m, slash: string) => `[${slash}metin]`);
}

/** Kriterleri komuta yazar: anahtar, ad, açıklama ve düzeyler (küçükten büyüğe). Ağırlık yazılmaz: puanı etkilemesin. */
export function formatCriteria(rubric: JudgeRubric): string {
  return rubric.criteria
    .map((criterion) => {
      const levels = [...criterion.levels]
        .sort((a, b) => a.score - b.score)
        .map((level) => `  ${level.score} puan: ${level.descriptor}`);
      return [`- ${criterion.key} (${criterion.label}): ${criterion.description}`, ...levels].join(
        '\n',
      );
    })
    .join('\n');
}

/**
 * Yargıç şablonunun boşlukları. Metni yazan modelin adı buraya hiç girmez (kör değerlendirme, T19):
 * girdide yalnızca tür, tema, metin ve rubrik vardır.
 */
export function judgeVars(input: {
  genre: Genre;
  theme: string;
  text: string;
  rubric: JudgeRubric;
}): Record<string, string> {
  if (input.text.trim() === '') throw new Error('Değerlendirilecek metin boş olamaz');
  const { tur, tema } = generationVars(input.genre, input.theme);
  const { min, max } = input.rubric.scale;
  return {
    tur: tur as string,
    tema: tema as string,
    olcek: `${min}-${max}`,
    kriterler: formatCriteria(input.rubric),
    metin: neutralizeText(input.text),
  };
}

export interface JudgeAnswer {
  puanlar: Record<string, { puan: number; gerekce: string }>;
}

/**
 * Yargıcın cevap şeması, rubrikten kurulur: her kriter zorunlu, fazlası yasak, puan ölçek içinde tam sayı.
 * Eksik kriter, ölçek dışı ya da sayı olmayan puan bu şemada reddedilir (T15, T17).
 */
export function judgeOutputSchema(rubric: JudgeRubric): z.ZodType<JudgeAnswer> {
  const { min, max } = rubric.scale;
  const entries = rubric.criteria.map((criterion) => [
    criterion.key,
    z.strictObject({ puan: z.number().int().min(min).max(max), gerekce: z.string() }),
  ]);
  return z.strictObject({
    puanlar: z.strictObject(Object.fromEntries(entries)),
  }) as unknown as z.ZodType<JudgeAnswer>;
}

/**
 * Ağırlıklı toplam, 0-100: her puan önce min-max ile 0-100'e çevrilir (ADR 0009), sonra ağırlıkla toplanır.
 * Puanlama hesabı yalnızca burada yapılır. Eksik kriter hata verir; en düşük puan 0 olarak korunur.
 */
export function weightedTotal(rubric: JudgeRubric, scores: Record<string, number>): number {
  return rubric.criteria.reduce((total, criterion) => {
    const score = scores[criterion.key];
    if (score === undefined) throw new Error(`Kriter için puan yok: ${criterion.key}`);
    return total + criterion.weight * normalizeScore(score, rubric.scale);
  }, 0);
}
