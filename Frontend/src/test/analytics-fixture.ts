import type { Condition, Group, RubricLite, StatsReport } from '../features/analytics/data';

/** Sahte API yanıtları. Gerçek veri değildir: yalnızca ekranın okuduğu biçimi sınar. */
export const A = 'anthropic/claude-a';
export const B = 'google/gemini-b';

const group = (anahtar: string, n: number, ortalama: number): Group => ({
  anahtar,
  n,
  ortalama,
  ortanca: ortalama,
  sd: 1.5,
  enDusuk: ortalama - 2,
  enYuksek: ortalama + 2,
});

export const condition: Condition = {
  hakem: 'deepseek/deepseek-flash',
  rubrikSurumu: '0.1-taslak',
  hakemKomutSurumu: 'v1',
  metin: 12,
  elleGirilen: 0,
  olculemeyen: 0,
  kirilimlar: [
    { etiket: 'tüm türler', gruplar: [group(A, 6, 70), group(B, 6, 50)] },
    { etiket: 'tür siir', gruplar: [group(A, 3, 80), group(B, 3, 40)] },
    // B bu türde hiç metin üretmemiş: hücre boş görünmeli.
    { etiket: 'tür hikaye', gruplar: [group(A, 3, 60)] },
    { etiket: 'tema Aşk', gruplar: [group(A, 6, 70), group(B, 6, 50)] },
  ],
  karsilastirmalar: [
    {
      kapsam: 'tür siir',
      gruplar: [group(A, 3, 80), group(B, 3, 40)],
      kruskalWallis: { h: 3.86, sd: 1, p: 0.0495, epsilonKare: 0.64 },
      ikililer: [{ a: A, b: B, u: 0, p: 0.1, pHolm: 0.2, cliffDelta: -1, tam: true }],
      notlar: ['Grup başına 5 metinden az: Kruskal-Wallis ki-kare yaklaşımı güvenilir değil'],
    },
  ],
  profiller: [
    {
      kapsam: 'tür siir',
      kriterler: ['imge', 'ritim'],
      gruplar: [
        { anahtar: A, n: 3, ortalamalar: { imge: 4.5, ritim: 3.5 } },
        { anahtar: B, n: 3, ortalamalar: { imge: 2 } },
      ],
    },
  ],
};

export const report: StatsReport = {
  olusturulma: '2026-11-24T00:00:00.000Z',
  kosullar: [condition],
};

export const rubrics: RubricLite[] = [
  {
    genre: 'siir',
    version: '0.1-taslak',
    scale: { min: 1, max: 5 },
    criteria: [
      { key: 'imge', label: 'İmge gücü' },
      { key: 'ritim', label: 'Ritim ve ahenk' },
    ],
  },
];

export const envelope = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
