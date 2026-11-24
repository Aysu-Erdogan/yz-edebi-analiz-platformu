/**
 * `POST /comparisons` sözleşmesi ve ekranın kullandığı saf yardımcılar (DOM'a dokunmaz).
 * Anahtarlar backend'in yanıtıyla aynıdır (docs/openapi.yaml).
 */

export const MAX_BODY_LENGTH = 20_000;
export const THEMES = ['Aşk', 'Doğa', 'Teknoloji'] as const;
export const GENRES = ['siir', 'hikaye', 'deneme'] as const;
export const SLOT_LETTERS = ['A', 'B', 'C'] as const;

export interface ComparisonRequest {
  genre: string;
  theme: string;
  items: { label: string; body: string }[];
}

export interface ScoredCriterion {
  key: string;
  /** Ham puan (rubrik ölçeğinde). */
  score: number;
  /** 0-100 karşılığı. */
  normalized: number;
  comment: string;
}

export type ComparisonItem =
  | {
      label: string | null;
      textId: number;
      status: 'succeeded';
      /** Ağırlıklı toplam, 0-100. */
      totalScore: number;
      scores: ScoredCriterion[];
      costUsd: number | null;
    }
  | { label: string | null; textId: number; status: 'failed'; error: string };

export interface ComparisonResult {
  genre: string;
  theme: string;
  judge: string;
  rubric: {
    id: number;
    version: string;
    scale: { min: number; max: number };
    criteria: { key: string; label: string; weight: number }[];
  };
  items: ComparisonItem[];
  totalCostUsd: number | null;
}

export interface Slot {
  label: string;
  body: string;
}

/** Boş bırakılan alanlar atlanır; etiketi boş olan metin "Metin A/B/C" adını alır (yuvanın harfi korunur). */
export function buildRequest(genre: string, theme: string, slots: Slot[]): ComparisonRequest {
  return {
    genre,
    theme,
    items: slots.flatMap((slot, i) =>
      slot.body.trim()
        ? [{ label: slot.label.trim() || `Metin ${SLOT_LETTERS[i]}`, body: slot.body.trim() }]
        : [],
    ),
  };
}

/** Skoru en yüksek olanların indeksleri (beraberlikte hepsi); sayı yoksa boş. */
export function bestIndexes(values: (number | null)[]): number[] {
  const present = values.flatMap((v) => (v === null ? [] : [v]));
  if (present.length === 0) return [];
  const best = Math.max(...present);
  return values.flatMap((v, i) => (v === best ? [i] : []));
}

/** Kriter ağırlıkları yüzdeye çevrilir (rubrikte 0,5/0,3/0,2 ya da 50/30/20 yazılmış olabilir). */
export function weightPercents(criteria: { weight: number }[]): number[] {
  const sum = criteria.reduce((a, c) => a + c.weight, 0);
  return criteria.map((c) => (sum > 0 ? (c.weight / sum) * 100 : 0));
}

/** Bir öğenin bir kriterdeki ham puanı; öğe başarısızsa ya da kriter yoksa null. */
export function rawScore(item: ComparisonItem, key: string): number | null {
  if (item.status !== 'succeeded') return null;
  return item.scores.find((s) => s.key === key)?.score ?? null;
}
