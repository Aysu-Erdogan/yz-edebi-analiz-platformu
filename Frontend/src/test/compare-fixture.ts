import type { ComparisonItem, ComparisonResult } from '../features/compare/data';

/** Sahte karşılaştırma yanıtları. Gerçek veri değildir: yalnızca ekranın okuduğu biçimi sınar. */
export const succeededItem = (
  textId: number,
  label: string | null,
  totalScore: number,
  raw: Record<string, number>,
): ComparisonItem => ({
  label,
  textId,
  status: 'succeeded',
  totalScore,
  scores: Object.entries(raw).map(([key, score]) => ({
    key,
    score,
    normalized: ((score - 1) / 4) * 100,
    comment: `${label ?? textId} ${key} gerekçesi`,
  })),
  costUsd: 0.0012,
});

export const failedItem = (textId: number, label: string | null): ComparisonItem => ({
  label,
  textId,
  status: 'failed',
  error: 'hakem geçersiz cevap verdi',
});

export const result = (items: ComparisonItem[]): ComparisonResult => ({
  genre: 'siir',
  theme: 'Doğa',
  judge: 'deepseek/deepseek-flash',
  rubric: {
    id: 1,
    version: '0.1-taslak',
    scale: { min: 1, max: 5 },
    criteria: [
      { key: 'imge', label: 'İmge gücü', weight: 0.6 },
      { key: 'ritim', label: 'Ritim ve ahenk', weight: 0.4 },
    ],
  },
  items,
  totalCostUsd: 0.0036,
});

export const threeItems = result([
  succeededItem(11, 'ChatGPT', 70, { imge: 3, ritim: 5 }),
  succeededItem(12, 'Claude', 85.5, { imge: 5, ritim: 4 }),
  succeededItem(13, 'Gemini', 60, { imge: 3, ritim: 2 }),
]);
