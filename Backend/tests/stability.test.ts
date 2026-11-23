import { describe, expect, it } from 'vitest';
import type { ExportEvaluation } from '../src/domain/export.js';
import { computeStability, formatStability, stabilityJson } from '../src/domain/stability.js';

let nextId = 1;

/** Bir puanlama kaydı: metin, tekrar no, toplam puan ve kriter puanları. */
function rec(
  textId: number,
  replicateNo: number,
  total: number | null,
  scores: Record<string, number> = {},
  over: Partial<ExportEvaluation> = {},
): ExportEvaluation {
  return {
    evaluationId: nextId++,
    textId,
    genre: 'siir',
    theme: 'Sonbahar',
    textBody: 'metin',
    author: null,
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
    inputTokens: 10,
    outputTokens: 10,
    latencyMs: 1,
    scores: Object.entries(scores).map(([criterionKey, score]) => ({
      criterionKey,
      score,
      comment: null,
    })),
    ...over,
  };
}

/** Pilota benzeyen veri: metin 1'de üç tekrar 90-80-80, metin 2 ve 3'te üç tekrar aynı. */
const pilot = [
  rec(1, 1, 90, { imge: 5, ritim: 4 }),
  rec(1, 2, 80, { imge: 4, ritim: 4 }),
  rec(1, 3, 80, { imge: 4, ritim: 4 }),
  rec(2, 1, 70, { imge: 4, ritim: 4 }),
  rec(2, 2, 70, { imge: 4, ritim: 4 }),
  rec(2, 3, 70, { imge: 4, ritim: 4 }),
  rec(3, 1, 55, { imge: 3, ritim: 4 }),
  rec(3, 2, 55, { imge: 3, ritim: 4 }),
  rec(3, 3, 55, { imge: 3, ritim: 4 }),
];

/**
 * s_r, ortalama aralık ve en büyük aralığın birbirinden farklı çıktığı veri (alanların karışması görünsün):
 * A [10,20] (varyans 50, serbestlik 1, aralık 10), B [1,2,3] (varyans 1, serbestlik 2, aralık 2)
 * → s_r = karekök((50 + 2) / 3) = 4,1633; ortalama aralık (10 + 2) / 2 = 6; en büyük aralık 10.
 */
const weighted = [rec(1, 1, 10), rec(1, 2, 20), rec(2, 1, 1), rec(2, 2, 2), rec(2, 3, 3)];

describe('computeStability: metin başına grup', () => {
  it('90-80-80: ortalama, en düşük, en yüksek, aralık ve örneklem standart sapması (n-1)', () => {
    const { groups } = computeStability(pilot);
    const g = groups.find((x) => x.textId === 1)!;
    expect(g.replicates).toBe(3);
    expect(g.failed).toBe(0);
    expect(g.total).not.toBeNull();
    expect(g.total!.mean).toBeCloseTo(83.3333, 3);
    expect(g.total!.min).toBe(80);
    expect(g.total!.max).toBe(90);
    expect(g.total!.range).toBe(10);
    // sapmaların kareleri toplamı 66,667; n-1 = 2'ye bölünce 33,333; karekökü 5,7735
    expect(g.total!.sd).toBeCloseTo(5.7735, 3);
  });

  it('üç tekrar aynıysa sapma 0 ve aralık 0', () => {
    const g = computeStability(pilot).groups.find((x) => x.textId === 2)!;
    expect(g.total).toMatchObject({ mean: 70, range: 0, sd: 0 });
  });

  it('tek başarılı tekrar ölçülemez: sapma 0 yazılmaz, toplam boş kalır', () => {
    const report = computeStability([rec(1, 1, 80, { imge: 4 })]);
    expect(report.groups[0]).toMatchObject({ replicates: 1, total: null });
  });

  it('başarısız tekrar hesaba girmez ama sayılır', () => {
    const report = computeStability([
      rec(1, 1, 80, { imge: 4 }),
      rec(1, 2, 70, { imge: 3 }),
      rec(1, 3, null),
    ]);
    const g = report.groups[0]!;
    expect(g.replicates).toBe(2);
    expect(g.failed).toBe(1);
    expect(g.total).toMatchObject({ mean: 75, range: 10 });
    expect(report.conditions[0]!.failed).toBe(1);
  });

  it('hiç başarılı tekrarı olmayan grup ölçülemez, başarısızlar sayılır', () => {
    const report = computeStability([rec(1, 1, null), rec(1, 2, null)]);
    expect(report.groups[0]).toMatchObject({ replicates: 0, failed: 2, total: null });
    expect(report.conditions[0]).toMatchObject({
      groups: 1,
      measurable: 0,
      failed: 2,
      repeatabilitySd: null,
      meanRange: null,
      maxRange: null,
    });
  });

  it('kayan nokta gürültüsü "aynı" sayılır (örn. 70 ve 70,0000000001)', () => {
    const report = computeStability([rec(1, 1, 70), rec(1, 2, 70.0000000001)]);
    expect(report.conditions[0]!.identicalGroups).toBe(1);
  });

  it('kayıt yoksa boş rapor döner', () => {
    expect(computeStability([])).toEqual({ conditions: [], groups: [] });
  });
});

describe('computeStability: hakem koşulu özeti', () => {
  it('pilot verisi: tekrar sapması s_r, ortalama ve en büyük aralık, tamamen aynı metin sayısı', () => {
    const [c] = computeStability(pilot).conditions;
    expect(c).toMatchObject({
      judge: 'deepseek/deepseek-flash',
      genre: 'siir',
      rubricVersion: '0.1-taslak',
      judgeTemplateVersion: 'v1',
      groups: 3,
      measurable: 3,
      failed: 0,
      maxRange: 10,
      identicalGroups: 2,
    });
    // s_r = karekök((2×33,333 + 0 + 0) / (2+2+2)) = karekök(11,111) = 3,3333
    expect(c!.repeatabilitySd).toBeCloseTo(3.3333, 3);
    expect(c!.meanRange).toBeCloseTo(3.3333, 3);
  });

  it('farklı tekrar sayılı gruplar serbestlik derecesiyle ağırlıklandırılır', () => {
    // A: [10,20] varyans 50, sd 1 ; B: [1,2,3] varyans 1, sd 2
    // birleşik varyans = (1×50 + 2×1) / (1+2) = 17,3333; karekök 4,1633
    const report = computeStability([
      rec(1, 1, 10),
      rec(1, 2, 20),
      rec(2, 1, 1),
      rec(2, 2, 2),
      rec(2, 3, 3),
    ]);
    expect(report.conditions[0]!.repeatabilitySd).toBeCloseTo(4.1633, 3);
  });

  it('ölçülemeyen gruplar özete girmez ama grup sayısında görünür', () => {
    const report = computeStability([rec(1, 1, 80), rec(1, 2, 70), rec(2, 1, 50)]);
    expect(report.conditions[0]).toMatchObject({ groups: 2, measurable: 1, maxRange: 10 });
  });

  it('kriter düzeyi: aynı çıkan hücre sayısı ve kriter başına tekrar sapması', () => {
    const { criteria } = computeStability(pilot).conditions[0]!;
    const imge = criteria.find((x) => x.key === 'imge')!;
    const ritim = criteria.find((x) => x.key === 'ritim')!;
    // metin 1'de imge 5,4,4: varyans 0,3333; diğer iki metinde 0 → s_r = karekök(2×0,3333/6) = 0,3333
    expect(imge).toMatchObject({ identical: 2, cells: 3 });
    expect(imge.repeatabilitySd).toBeCloseTo(0.3333, 3);
    expect(ritim).toMatchObject({ identical: 3, cells: 3, repeatabilitySd: 0 });
  });

  it('s_r, ortalama aralık ve en büyük aralık birbirinden ayrı alanlardır', () => {
    const [c] = computeStability(weighted).conditions;
    expect(c!.repeatabilitySd).toBeCloseTo(4.1633, 3);
    expect(c!.meanRange).toBe(6);
    expect(c!.maxRange).toBe(10);
  });

  it('bir kriteri yalnızca tek tekrarda bulunan hücre ölçülmez (sapma 0 ya da NaN yazılmaz)', () => {
    const { criteria } = computeStability([
      rec(1, 1, 80, { imge: 4, ritim: 3 }),
      rec(1, 2, 70, { imge: 3 }),
    ]).conditions[0]!;
    expect(criteria.find((c) => c.key === 'imge')).toMatchObject({ cells: 1, identical: 0 });
    expect(criteria.find((c) => c.key === 'ritim')).toMatchObject({
      cells: 0,
      identical: 0,
      repeatabilitySd: null,
    });
  });

  it('farklı hakemler ayrı koşuldur', () => {
    const report = computeStability([
      rec(1, 1, 80),
      rec(1, 2, 70),
      rec(1, 1, 60, {}, { judge: 'anthropic/claude-x' }),
      rec(1, 2, 50, {}, { judge: 'anthropic/claude-x' }),
    ]);
    expect(report.conditions.map((c) => c.judge)).toEqual([
      'anthropic/claude-x',
      'deepseek/deepseek-flash',
    ]);
  });

  it('farklı rubrik ya da hakem komutu sürümü aynı metinde bile karışmaz', () => {
    const report = computeStability([
      rec(1, 1, 80),
      rec(1, 2, 70),
      rec(1, 3, 40, {}, { rubricVersion: '0.2' }),
      rec(1, 4, 30, {}, { judgeTemplateVersion: 'v2' }),
    ]);
    expect(report.conditions).toHaveLength(3);
    const first = report.groups.find(
      (g) => g.rubricVersion === '0.1-taslak' && g.judgeTemplateVersion === 'v1',
    )!;
    expect(first.replicates).toBe(2);
    expect(first.total!.range).toBe(10);
    const others = report.groups.filter((g) => g !== first);
    expect(others.every((g) => g.replicates === 1 && g.total === null)).toBe(true);
  });

  it('farklı türler ayrı koşuldur (kriterleri farklıdır)', () => {
    const report = computeStability([
      rec(1, 1, 80, { imge: 4 }),
      rec(1, 2, 70, { imge: 3 }),
      rec(2, 1, 60, { olay: 3 }, { genre: 'hikaye' }),
      rec(2, 2, 60, { olay: 3 }, { genre: 'hikaye' }),
    ]);
    expect(report.conditions.map((c) => c.genre)).toEqual(['hikaye', 'siir']);
    expect(report.conditions[0]!.criteria.map((c) => c.key)).toEqual(['olay']);
    expect(report.conditions[1]!.criteria.map((c) => c.key)).toEqual(['imge']);
  });

  it('sıra kayıt sırasından bağımsızdır: koşullar hakem ve türe, gruplar hakem ve metin kimliğine göre', () => {
    const forward = computeStability(pilot);
    const backward = computeStability([...pilot].reverse());
    expect(backward).toEqual(forward);
    expect(forward.groups.map((g) => g.textId)).toEqual([1, 2, 3]);
  });
});

describe('formatStability: ekran çıktısı', () => {
  it('pilot verisi için sayıları ve oranları yazar', () => {
    const text = formatStability(computeStability(pilot)).join('\n');
    expect(text).toContain('deepseek/deepseek-flash');
    expect(text).toContain('siir');
    expect(text).toContain('rubrik 0.1-taslak');
    expect(text).toContain('hakem komutu v1');
    expect(text).toContain('Metin: 3 (ölçülebilen 3, ölçülemeyen 0)');
    expect(text).toContain('tekrar sapması (s_r) 3.33');
    expect(text).toContain('en büyük aralık 10.00');
    expect(text).toContain('tamamen aynı çıkan metin 2/3');
    expect(text).toContain('tamamen aynı çıkan hücre 5/6 (%83.3)');
    expect(text).toContain('imge: s_r 0.33, tamamen aynı 2/3');
    expect(text).toContain('ritim: s_r 0.00, tamamen aynı 3/3');
  });

  it('s_r, ortalama aralık ve en büyük aralığı kendi alanlarından yazar', () => {
    const text = formatStability(computeStability(weighted)).join('\n');
    expect(text).toContain(
      'tekrar sapması (s_r) 4.16 · ortalama aralık 6.00 · en büyük aralık 10.00 · tamamen aynı çıkan metin 0/2',
    );
  });

  it('hiçbir grup ölçülemiyorsa bunu açıkça söyler, sapma sayısı yazmaz', () => {
    const text = formatStability(computeStability([rec(1, 1, 80), rec(2, 1, 70)])).join('\n');
    expect(text).toContain('ölçülemedi');
    expect(text).not.toContain('tekrar sapması (s_r)');
  });

  it('komut sürümü bilinmiyorsa bunu yazar', () => {
    const text = formatStability(
      computeStability([rec(1, 1, 80, {}, { judgeTemplateVersion: null })]),
    ).join('\n');
    expect(text).toContain('hakem komutu bilinmiyor');
  });

  it('kayıt yoksa uyarı verir', () => {
    expect(formatStability(computeStability([])).join('\n')).toContain('hiç puanlama kaydı yok');
  });
});

describe('stabilityJson', () => {
  it('Türkçe anahtarlarla koşulları ve grupları yazar, oluşturulma zamanı verilen saattir', () => {
    const json = JSON.parse(
      stabilityJson(computeStability(pilot), new Date('2026-11-23T12:00:00.000Z')),
    );
    expect(json.olusturulma).toBe('2026-11-23T12:00:00.000Z');
    expect(json.kosullar).toHaveLength(1);
    expect(json.kosullar[0]).toMatchObject({
      hakem: 'deepseek/deepseek-flash',
      tur: 'siir',
      rubrikSurumu: '0.1-taslak',
      hakemKomutSurumu: 'v1',
      grupSayisi: 3,
      olculebilenGrup: 3,
      basarisizPuanlama: 0,
      enBuyukAralik: 10,
      tamamenAyniGrup: 2,
    });
    expect(json.kosullar[0].tekrarSapmasi).toBeCloseTo(3.3333, 3);
    expect(json.kosullar[0].kriterler[0]).toMatchObject({ kriter: 'imge', ayniHucre: 2, hucre: 3 });
    expect(json.gruplar).toHaveLength(3);
    expect(json.gruplar[0]).toMatchObject({
      metinId: 1,
      hakem: 'deepseek/deepseek-flash',
      tekrar: 3,
      basarisiz: 0,
      aralik: 10,
      enDusuk: 80,
      enYuksek: 90,
    });
  });

  it('tekrar sapması, ortalama aralık ve en büyük aralık ayrı alanlardan yazılır', () => {
    const json = JSON.parse(stabilityJson(computeStability(weighted), new Date(0)));
    expect(json.kosullar[0].tekrarSapmasi).toBeCloseTo(4.1633, 3);
    expect(json.kosullar[0].ortalamaAralik).toBe(6);
    expect(json.kosullar[0].enBuyukAralik).toBe(10);
  });

  it('ölçülemeyen grupta sapma alanları null olur (0 değil)', () => {
    const json = JSON.parse(stabilityJson(computeStability([rec(1, 1, 80)]), new Date(0)));
    expect(json.gruplar[0]).toMatchObject({
      tekrar: 1,
      ortalama: null,
      aralik: null,
      standartSapma: null,
    });
    expect(json.kosullar[0]).toMatchObject({ tekrarSapmasi: null, ortalamaAralik: null });
  });
});
