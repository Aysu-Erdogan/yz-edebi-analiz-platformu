import type { TextDetail, TextEvaluation, TextSummary } from '../features/library/data';

/** Sahte kütüphane yanıtları. Gerçek veri değildir: yalnızca ekranın okuduğu biçimi sınar. */
export const claude = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-5-5',
  displayName: 'Claude Sonnet 5.5',
};

export const summary = (id: number, over: Partial<TextSummary> = {}): TextSummary => ({
  id,
  genre: 'siir',
  theme: 'Doğa',
  source: 'generated',
  label: null,
  author: claude,
  wordCount: 4,
  excerpt: 'Yaprak düşer, rüzgâr eser.',
  createdAt: '2026-11-24T10:00:00.000Z',
  succeededEvaluations: 3,
  ...over,
});

export const texts: TextSummary[] = [
  summary(4),
  summary(5, { genre: 'hikaye', theme: 'Aşk', excerpt: 'Bir varmış bir yokmuş.', wordCount: 250 }),
  summary(31, {
    source: 'manual',
    author: null,
    label: 'ChatGPT',
    theme: 'Sonbahar',
    succeededEvaluations: 0,
    excerpt: 'Elle yazılmış.',
  }),
];

export const evaluation = (
  id: number,
  replicateNo: number,
  over: Partial<TextEvaluation> = {},
): TextEvaluation => ({
  id,
  judge: 'deepseek/deepseek-flash',
  rubricVersion: '0.1-taslak',
  templateVersion: 'v1',
  replicateNo,
  status: 'succeeded',
  error: null,
  totalScore: 65,
  scores: [
    { key: 'imge', label: 'İmge Gücü', score: 5, comment: `imge gerekçesi ${replicateNo}` },
    { key: 'ritim', label: 'Ritim ve Ahenk', score: 3, comment: null },
  ],
  createdAt: '2026-11-24T10:05:00.000Z',
  ...over,
});

export const detail = (over: Partial<TextDetail> = {}): TextDetail => ({
  ...summary(5),
  body: 'Yaprak düşer,\nrüzgâr eser.',
  generation: {
    templateVersion: 'v1',
    replicateNo: 2,
    inputTokens: 1234,
    outputTokens: 200,
    latencyMs: 6100,
  },
  evaluations: [
    evaluation(10, 1, { totalScore: 65 }),
    evaluation(11, 2, {
      totalScore: 80,
      scores: [
        { key: 'imge', label: 'İmge Gücü', score: 4, comment: 'ikinci imge' },
        { key: 'ritim', label: 'Ritim ve Ahenk', score: 4, comment: 'ikinci ritim' },
      ],
    }),
    evaluation(12, 3, {
      status: 'failed',
      totalScore: null,
      scores: [],
      error: 'hakem geçersiz cevap verdi',
    }),
  ],
  ...over,
});
