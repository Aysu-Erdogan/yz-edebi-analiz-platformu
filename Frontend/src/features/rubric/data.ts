/** `GET /rubrics` yanıtının tipleri ve ekranın kullandığı saf yardımcılar (DOM'a dokunmaz). */

export type RubricStatus = 'draft' | 'active' | 'archived';

export interface RubricLevel {
  score: number;
  descriptor: string;
}

export interface RubricCriterion {
  key: string;
  label: string;
  description: string;
  weight: number;
  levels: RubricLevel[];
}

export interface Rubric {
  id: number;
  genre: string;
  version: string;
  /** Rubriğin kaynağı ve geçerlilik notu (örn. "GEÇİCİ TASLAK: uzman doğrulaması yok"); yoksa alan hiç gelmez. */
  sourceNote?: string;
  scale: { min: number; max: number };
  criteria: RubricCriterion[];
  status: RubricStatus;
}

export const STATUS_LABEL: Record<RubricStatus, string> = {
  active: 'Etkin',
  draft: 'Taslak',
  archived: 'Arşiv',
};

const STATUS_ORDER: Record<RubricStatus, number> = { active: 0, draft: 1, archived: 2 };

/** Bir türün rubrikleri: etkin olan önce, sonra taslaklar, en son arşiv; aynı durumda yeni kayıt önce. */
export function rubricsOfGenre(rubrics: Rubric[], genre: string): Rubric[] {
  return rubrics
    .filter((r) => r.genre === genre)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.id - a.id);
}

/** Ham puanın 0-100 karşılığı: aralık tabanlı (min-max), ADR 0009. */
export function normalizedScore(score: number, scale: { min: number; max: number }): number {
  return ((score - scale.min) / (scale.max - scale.min)) * 100;
}
