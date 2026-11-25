import type { Rubric, RubricCriterion } from '../features/rubric/data';

/** Sahte rubrik yanıtları. Gerçek rubrik değildir: yalnızca ekranın okuduğu biçimi sınar. */
const criterion = (
  key: string,
  label: string,
  weight: number,
  scores = [1, 3, 5],
): RubricCriterion => ({
  key,
  label,
  description: `${label} açıklaması`,
  weight,
  levels: scores.map((score) => ({ score, descriptor: `${label} ${score} puan düzeyi` })),
});

export const rubrics: Rubric[] = [
  {
    id: 1,
    genre: 'siir',
    version: '0.1-taslak',
    sourceNote: 'GEÇİCİ TASLAK: uzman doğrulaması yok.',
    scale: { min: 1, max: 5 },
    status: 'active',
    criteria: [
      criterion('imge', 'İmge Gücü', 0.5),
      criterion('ritim', 'Ritim ve Ahenk', 0.3),
      criterion('ozgun', 'Özgünlük', 0.2),
    ],
  },
  {
    id: 2,
    genre: 'siir',
    version: '0.2',
    scale: { min: 1, max: 5 },
    status: 'draft',
    criteria: [criterion('yeni', 'Yeni Kriter', 1)],
  },
  {
    id: 3,
    genre: 'siir',
    version: '0.0',
    scale: { min: 1, max: 5 },
    status: 'archived',
    criteria: [criterion('eski', 'Eski Kriter', 1)],
  },
  {
    id: 4,
    genre: 'hikaye',
    version: '1.0',
    scale: { min: 1, max: 4 },
    status: 'active',
    criteria: [criterion('olay', 'Olay Örgüsü', 1, [1, 3, 4])],
  },
];
