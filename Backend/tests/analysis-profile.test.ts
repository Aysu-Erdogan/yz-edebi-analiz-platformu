import { describe, expect, it } from 'vitest';
import { analysisJson, analysisReport, analyze, filterThemes } from '../src/domain/analysis.js';
import type { ExportEvaluation } from '../src/domain/export.js';

let nextId = 1;

/** `yazar` "sağlayıcı/model"; `scores` kriter anahtarı → ham puan; total null = başarısız puanlama. */
function rec(
  textId: number,
  yazar: string,
  replicateNo: number,
  total: number | null,
  scores: Record<string, number> = {},
  over: Partial<ExportEvaluation> = {},
): ExportEvaluation {
  const [provider, modelId] = yazar.split('/');
  return {
    evaluationId: nextId++,
    textId,
    genre: 'siir',
    theme: 'Aşk',
    textBody: 'metin',
    author: { provider: provider!, modelId: modelId! },
    label: null,
    judge: 'deepseek/deepseek-flash',
    replicateNo,
    status: total === null ? 'failed' : 'succeeded',
    error: null,
    totalScore: total,
    rubricVersion: '0.1-taslak',
    rubricNote: null,
    judgeTemplateVersion: 'v1',
    generationTemplateVersion: 'v1',
    attempts: 1,
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    scores: Object.entries(scores).map(([criterionKey, score]) => ({
      criterionKey,
      score,
      comment: null,
    })),
    ...over,
  };
}

describe('analyze: kriter profili (radar grafiği için)', () => {
  it('yazar başına kriter ortalaması: önce metin içinde tekrarlar, sonra metinler ortalanır', () => {
    // a: metin 1 → imge (4+5)/2 = 4,5, ritim 3; metin 2 → imge 3, ritim (5+4)/2 = 4,5
    //    yazar ortalaması imge (4,5+3)/2 = 3,75, ritim (3+4,5)/2 = 3,75. b: tek metin imge 2, ritim 2.
    const [c] = analyze([
      rec(1, 'a/m', 1, 60, { imge: 4, ritim: 3 }),
      rec(1, 'a/m', 2, 70, { imge: 5, ritim: 3 }),
      rec(2, 'a/m', 1, 50, { imge: 3, ritim: 5 }),
      rec(2, 'a/m', 2, 50, { imge: 3, ritim: 4 }),
      rec(3, 'b/m', 1, 20, { imge: 2, ritim: 2 }),
    ]);
    expect(c!.profiles).toEqual([
      {
        scope: 'tür siir',
        criteria: ['imge', 'ritim'],
        groups: [
          { key: 'a/m', n: 2, means: { imge: 3.75, ritim: 3.75 } },
          { key: 'b/m', n: 1, means: { imge: 2, ritim: 2 } },
        ],
      },
    ]);
  });

  it('her tür ayrı profildir (kriterler türe göre farklıdır) ve türler sıralıdır', () => {
    const [c] = analyze([
      rec(1, 'a/m', 1, 60, { imge: 4 }),
      rec(2, 'a/m', 1, 60, { olay: 5 }, { genre: 'hikaye' }),
    ]);
    expect(c!.profiles.map((p) => [p.scope, p.criteria])).toEqual([
      ['tür hikaye', ['olay']],
      ['tür siir', ['imge']],
    ]);
  });

  it('başarısız tekrarın kriter puanı ortalamaya girmez', () => {
    const [c] = analyze([
      rec(1, 'a/m', 1, 60, { imge: 4 }),
      rec(1, 'a/m', 2, null, { imge: 1 }), // başarısız kayıtta puan olmaz ama olsa da sayılmamalı
    ]);
    expect(c!.profiles[0]!.groups[0]!.means).toEqual({ imge: 4 });
  });

  it('puanı olmayan metin profile girmez; kriter puanı hiç yoksa ortalamalar boş', () => {
    const [c] = analyze([rec(1, 'a/m', 1, 60), rec(2, 'b/m', 1, null)]);
    expect(c!.profiles[0]).toMatchObject({
      criteria: [],
      groups: [{ key: 'a/m', n: 1, means: {} }],
    });
  });

  it('kayıt sırası sonucu değiştirmez', () => {
    const records = [
      rec(1, 'a/m', 1, 60, { imge: 4, ritim: 3 }),
      rec(2, 'b/m', 1, 40, { imge: 2, ritim: 1 }),
      rec(3, 'a/m', 1, 70, { imge: 5, ritim: 4 }),
    ];
    expect(analyze([...records].reverse())).toEqual(analyze(records));
  });
});

describe('filterThemes', () => {
  const records = [
    rec(1, 'a/m', 1, 60, {}, { theme: 'Aşk' }),
    rec(2, 'a/m', 1, 60, {}, { theme: 'Doğa' }),
    rec(3, 'a/m', 1, 60, {}, { theme: 'Sonbahar' }),
  ];

  it('virgülle ayrılmış temalara göre süzer, boşlukları kırpar', () => {
    expect(filterThemes(records, ' Aşk , Doğa ').map((r) => r.theme)).toEqual(['Aşk', 'Doğa']);
  });

  it('tanımsız, boş ya da yalnızca ayraçlı değer süzgeç koymaz', () => {
    for (const raw of [undefined, '', ' , ']) expect(filterThemes(records, raw)).toHaveLength(3);
  });

  it('eşleşme yoksa boş döner', () => {
    expect(filterThemes(records, 'Yok')).toEqual([]);
  });
});

describe('analysisReport', () => {
  const conditions = analyze([
    rec(1, 'a/m', 1, 60, { imge: 4 }),
    rec(2, 'b/m', 1, 40, { imge: 2 }),
  ]);

  it('JSON çıktısıyla aynı nesnedir (dosya ve uç aynı biçimi kullanır)', () => {
    const now = new Date('2026-11-24T12:00:00.000Z');
    expect(JSON.parse(analysisJson(conditions, now))).toEqual(analysisReport(conditions, now));
  });

  it('kriter profillerini Türkçe anahtarlarla verir', () => {
    const report = analysisReport(conditions, new Date(0));
    expect(report.olusturulma).toBe('1970-01-01T00:00:00.000Z');
    expect(report.kosullar[0]!.profiller).toEqual([
      {
        kapsam: 'tür siir',
        kriterler: ['imge'],
        gruplar: [
          { anahtar: 'a/m', n: 1, ortalamalar: { imge: 4 } },
          { anahtar: 'b/m', n: 1, ortalamalar: { imge: 2 } },
        ],
      },
    ]);
  });
});
