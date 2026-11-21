export interface Scale {
  min: number;
  max: number;
}

/**
 * Ham puanı 0–100'e çevirir: aralık tabanlı (min-max). En düşük puan 0, en yüksek 100 olur,
 * aralık eşit kalır (1–5 ölçeğinde 3 → 50). Oran tabanlı (puan/en büyük) kullanılmaz,
 * çünkü en düşük puana 0 yerine 20 verir. Karar: ADR 0009.
 *
 * Ölçeğin dışındaki puan sessizce kırpılmaz, hata fırlatır (sahte puan üretmeyiz, ADR 0004).
 */
export function normalizeScore(score: number, scale: Scale): number {
  if (!(scale.min < scale.max)) {
    throw new RangeError(
      `Geçersiz ölçek: en küçük (${scale.min}) en büyükten (${scale.max}) küçük olmalı`,
    );
  }
  if (!Number.isFinite(score) || score < scale.min || score > scale.max) {
    throw new RangeError(
      `Puan ${scale.min}–${scale.max} aralığında bir sayı olmalı (gelen: ${score})`,
    );
  }
  return ((score - scale.min) / (scale.max - scale.min)) * 100;
}
