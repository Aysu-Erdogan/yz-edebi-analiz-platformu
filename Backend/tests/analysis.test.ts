import { describe, expect, it } from 'vitest';
import { analysisJson, analyze, formatAnalysis } from '../src/domain/analysis.js';
import type { ExportEvaluation } from '../src/domain/export.js';

let nextId = 1;

/** `yazar` "sağlayıcı/model" biçiminde; null = elle girilen metin. total null = başarısız puanlama. */
function rec(
  textId: number,
  yazar: string | null,
  replicateNo: number,
  total: number | null,
  over: Partial<ExportEvaluation> = {},
): ExportEvaluation {
  const [provider, modelId] = (yazar ?? '').split('/');
  return {
    evaluationId: nextId++,
    textId,
    genre: 'siir',
    theme: 'Sonbahar',
    textBody: 'metin',
    author: yazar === null ? null : { provider: provider!, modelId: modelId! },
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
    scores: [],
    ...over,
  };
}

/** Her metin iki tekrarla puanlanır: t-10 ve t+10 (ortalaması t) → "tekrarlar ortalanır" görünür. */
function texts(
  yazar: string,
  firstId: number,
  totals: number[],
  over: Partial<ExportEvaluation> = {},
): ExportEvaluation[] {
  return totals.flatMap((t, i) => [
    rec(firstId + i, yazar, 1, t - 10, over),
    rec(firstId + i, yazar, 2, t + 10, over),
  ]);
}

// Üç yazar, tamamen ayrı puanlar: A 80,70,90 · B 50,60,40 · C 20,30,10 (her biri 3 metin)
const separated = [
  ...texts('a/model-a', 1, [80, 70, 90]),
  ...texts('b/model-b', 4, [50, 60, 40]),
  ...texts('c/model-c', 7, [20, 30, 10]),
];

describe('analyze: koşul ve ölçüm birimi', () => {
  it('ölçüm birimi metindir: tekrarlar ortalanır; yazar başına betimsel değerler', () => {
    const [c] = analyze(separated);
    expect(c).toMatchObject({
      judge: 'deepseek/deepseek-flash',
      rubricVersion: '0.1-taslak',
      judgeTemplateVersion: 'v1',
      texts: 9,
      manualTexts: 0,
      unmeasuredTexts: 0,
    });
    const all = c!.breakdowns.find((b) => b.label === 'tüm türler')!;
    expect(all.groups.map((g) => g.key)).toEqual(['a/model-a', 'b/model-b', 'c/model-c']);
    expect(all.groups[0]).toMatchObject({ n: 3, mean: 80, median: 80, min: 70, max: 90 });
    expect(all.groups[0]!.sd).toBeCloseTo(10, 12);
    expect(all.groups[1]).toMatchObject({ n: 3, mean: 50 });
    expect(all.groups[2]).toMatchObject({ n: 3, mean: 20 });
  });

  it('başarısız puanlama ortalamaya girmez', () => {
    const [c] = analyze([
      rec(1, 'a/model-a', 1, 80),
      rec(1, 'a/model-a', 2, null),
      rec(2, 'a/model-a', 1, 60),
    ]);
    const group = c!.breakdowns[0]!.groups[0]!;
    expect(group).toMatchObject({ n: 2, mean: 70 }); // metin 1: yalnızca 80; metin 2: 60
  });

  it('elle girilen metin (yazarı yok) ve hiç başarılı puanı olmayan metin dışarıda kalır, sayılır', () => {
    const [c] = analyze([
      ...texts('a/model-a', 1, [80]),
      rec(2, null, 1, 50),
      rec(3, 'a/model-a', 1, null),
    ]);
    expect(c).toMatchObject({ texts: 3, manualTexts: 1, unmeasuredTexts: 1 });
    expect(c!.breakdowns[0]!.groups[0]).toMatchObject({ n: 1, mean: 80 });
  });

  it('farklı hakem, rubrik ya da komut sürümü ayrı koşuldur', () => {
    const conditions = analyze([
      ...texts('a/model-a', 1, [80]),
      ...texts('a/model-a', 1, [60], { judge: 'anthropic/claude-x' }),
      ...texts('a/model-a', 1, [40], { rubricVersion: '0.2' }),
      ...texts('a/model-a', 1, [30], { judgeTemplateVersion: 'v2' }),
    ]);
    expect(conditions).toHaveLength(4);
    expect(conditions.map((c) => c.judge)).toEqual([
      'anthropic/claude-x',
      'deepseek/deepseek-flash',
      'deepseek/deepseek-flash',
      'deepseek/deepseek-flash',
    ]);
  });

  it('kayıt yoksa boş sonuç', () => {
    expect(analyze([])).toEqual([]);
  });

  it('kayıt sırası sonucu değiştirmez', () => {
    expect(analyze([...separated].reverse())).toEqual(analyze(separated));
  });
});

describe('analyze: kırılımlar ve karşılaştırmalar', () => {
  it('tüm türler, her tür ve her tema için betimsel kırılım', () => {
    const [c] = analyze([
      ...texts('a/model-a', 1, [80, 70]),
      ...texts('a/model-a', 3, [40], { genre: 'hikaye', theme: 'Deniz' }),
    ]);
    expect(c!.breakdowns.map((b) => b.label)).toEqual([
      'tüm türler',
      'tür hikaye',
      'tür siir',
      'tema Deniz',
      'tema Sonbahar',
    ]);
    const get = (label: string) => c!.breakdowns.find((b) => b.label === label)!.groups[0]!;
    expect(get('tüm türler')).toMatchObject({ n: 3 });
    expect(get('tür siir')).toMatchObject({ n: 2, mean: 75 });
    expect(get('tema Deniz')).toMatchObject({ n: 1, mean: 40 });
  });

  it('Kruskal-Wallis ve ikili Mann-Whitney: tamamen ayrı üç grup (H 7,2, ε² 0,9, tam p 0,1, Holm 0,3, δ +1)', () => {
    const [c] = analyze(separated);
    const all = c!.comparisons.find((x) => x.scope === 'tüm türler')!;
    expect(all.kruskal!.h).toBeCloseTo(7.2, 10);
    expect(all.kruskal!.df).toBe(2);
    expect(all.kruskal!.p).toBeCloseTo(Math.exp(-3.6), 10);
    expect(all.kruskal!.epsilonSquared).toBeCloseTo(0.9, 10);
    expect(all.pairs.map((p) => [p.a, p.b])).toEqual([
      ['a/model-a', 'b/model-b'],
      ['a/model-a', 'c/model-c'],
      ['b/model-b', 'c/model-c'],
    ]);
    for (const pair of all.pairs) {
      expect(pair).toMatchObject({ exact: true, cliffsDelta: 1 });
      expect(pair.p).toBeCloseTo(0.1, 12);
      expect(pair.pHolm).toBeCloseTo(0.3, 12);
    }
  });

  it('tür başına ayrı karşılaştırma kapsamı (tüm türler + her tür)', () => {
    const [c] = analyze([
      ...separated,
      ...texts('a/model-a', 20, [10, 20, 30], { genre: 'hikaye' }),
      ...texts('b/model-b', 23, [40, 50, 60], { genre: 'hikaye' }),
    ]);
    expect(c!.comparisons.map((x) => x.scope)).toEqual(['tüm türler', 'tür hikaye', 'tür siir']);
    expect(c!.comparisons.find((x) => x.scope === 'tür hikaye')!.groups.map((g) => g.n)).toEqual([
      3, 3,
    ]);
  });

  it('her yazar için en az 2 metin yoksa test yapılmaz ve nedeni yazılır (0 ya da uydurma p yok)', () => {
    const [c] = analyze([
      ...texts('a/model-a', 1, [80]),
      ...texts('b/model-b', 2, [50]),
      ...texts('c/model-c', 3, [20]),
    ]);
    const cmp = c!.comparisons[0]!;
    expect(cmp.kruskal).toBeNull();
    expect(cmp.pairs).toEqual([]);
    expect(cmp.notes.join(' ')).toContain('yetersiz örnek');
  });

  it('bir yazarın metni yetersizse yalnızca yeterli yazar çiftleri karşılaştırılır', () => {
    const [c] = analyze([
      ...texts('a/model-a', 1, [80, 70]),
      ...texts('b/model-b', 3, [50, 60]),
      ...texts('c/model-c', 5, [20]),
    ]);
    const cmp = c!.comparisons[0]!;
    expect(cmp.kruskal).toBeNull(); // c grubu 1 metin
    expect(cmp.pairs.map((p) => [p.a, p.b])).toEqual([['a/model-a', 'b/model-b']]);
  });

  it('grup başına 5 metinden az ise ki-kare yaklaşımı uyarısı yazılır; 5 ve üstünde yazılmaz', () => {
    const small = analyze(separated)[0]!.comparisons[0]!;
    expect(small.notes.join(' ')).toContain('5 metinden az');
    const big = analyze([
      ...texts('a/model-a', 1, [10, 20, 30, 40, 50]),
      ...texts('b/model-b', 6, [15, 25, 35, 45, 55]),
    ])[0]!.comparisons[0]!;
    expect(big.notes.join(' ')).not.toContain('5 metinden az');
  });
});

describe('formatAnalysis', () => {
  it('koşulu, grup satırlarını, Kruskal-Wallis ve ikili sonuçları yazar', () => {
    const text = formatAnalysis(analyze(separated)).join('\n');
    expect(text).toContain('deepseek/deepseek-flash');
    expect(text).toContain('rubrik 0.1-taslak');
    expect(text).toContain('9 metin');
    expect(text).toContain(
      'a/model-a: n 3 · ort 80.0 · ortanca 80.0 · sd 10.0 · en düşük 70.0 · en yüksek 90.0',
    );
    expect(text).toContain('Kruskal-Wallis: H 7.20 (sd 2) · p 0.0273 · ε² 0.90');
    expect(text).toContain(
      'a/model-a ↔ b/model-b: p 0.1000 (Holm 0.3000) · Cliff δ +1.00 · tam test',
    );
    expect(text).toContain('[tüm türler]');
    expect(text).toContain('[tür siir]');
    expect(text).toContain('[tema Sonbahar]');
  });

  it('yetersiz örnekte test satırı yerine nedeni yazar', () => {
    const text = formatAnalysis(
      analyze([...texts('a/model-a', 1, [80]), ...texts('b/model-b', 2, [50])]),
    ).join('\n');
    expect(text).toContain('yetersiz örnek');
    expect(text).not.toContain('Kruskal-Wallis: H');
  });

  it('elle girilen ve ölçülemeyen metin sayısını koşul satırında gösterir', () => {
    const text = formatAnalysis(
      analyze([...texts('a/model-a', 1, [80]), rec(2, null, 1, 50), rec(3, 'a/model-a', 1, null)]),
    ).join('\n');
    expect(text).toContain('elle girilen 1');
    expect(text).toContain('ölçülemeyen 1');
  });

  it('kayıt yoksa uyarır', () => {
    expect(formatAnalysis([]).join('\n')).toContain('hiç puanlama kaydı yok');
  });

  it('bağlı (tam olmayan) p değerini normal yaklaşım olarak işaretler', () => {
    const a = Array.from({ length: 11 }, (_, i) => 10 + i);
    const b = Array.from({ length: 11 }, (_, i) => 100 + i);
    const text = formatAnalysis(analyze([...texts('a/m', 1, a), ...texts('b/m', 100, b)])).join(
      '\n',
    );
    expect(text).toContain('yaklaşık test');
  });
});

describe('analysisJson', () => {
  it('Türkçe anahtarlarla koşulları, kırılımları ve karşılaştırmaları yazar', () => {
    const json = JSON.parse(analysisJson(analyze(separated), new Date('2026-11-24T12:00:00.000Z')));
    expect(json.olusturulma).toBe('2026-11-24T12:00:00.000Z');
    const k = json.kosullar[0];
    expect(k).toMatchObject({
      hakem: 'deepseek/deepseek-flash',
      rubrikSurumu: '0.1-taslak',
      hakemKomutSurumu: 'v1',
      metin: 9,
      elleGirilen: 0,
      olculemeyen: 0,
    });
    const tum = k.karsilastirmalar.find((x: { kapsam: string }) => x.kapsam === 'tüm türler');
    expect(tum.kruskalWallis.h).toBeCloseTo(7.2, 10);
    expect(tum.kruskalWallis.p).toBeCloseTo(Math.exp(-3.6), 10);
    expect(tum.ikililer[0]).toMatchObject({
      a: 'a/model-a',
      b: 'b/model-b',
      tam: true,
      cliffDelta: 1,
    });
    expect(tum.ikililer[0].pHolm).toBeCloseTo(0.3, 12);
    expect(k.kirilimlar[0].etiket).toBe('tüm türler');
    expect(k.kirilimlar[0].gruplar[0]).toMatchObject({
      anahtar: 'a/model-a',
      n: 3,
      ortalama: 80,
      ortanca: 80,
    });
  });

  it('test yapılamayan kapsamda kruskalWallis null olur', () => {
    const json = JSON.parse(analysisJson(analyze(texts('a/model-a', 1, [80])), new Date(0)));
    expect(json.kosullar[0].karsilastirmalar[0].kruskalWallis).toBeNull();
  });
});
