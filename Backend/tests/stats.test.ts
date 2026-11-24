import { describe as suite, expect, it } from 'vitest';
import {
  chiSquareSf,
  describe,
  holm,
  kruskalWallis,
  mannWhitney,
  midRanks,
  normalSf,
} from '../src/domain/stats.js';

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

suite('describe: betimsel istatistik', () => {
  it('çift sayıda değer: ortalama, ortanca (iki ortanın ortalaması), örneklem SD (n-1), uçlar', () => {
    const d = describe([1, 2, 3, 4]);
    expect(d).toMatchObject({ n: 4, mean: 2.5, median: 2.5, min: 1, max: 4 });
    expect(d.sd).toBeCloseTo(Math.sqrt(5 / 3), 10);
  });

  it('tek sayıda değer ve sırasız girdi: ortanca ortadaki sıralı değerdir', () => {
    expect(describe([3, 1, 2]).median).toBe(2);
  });

  it('tek değerde SD null (0 değil)', () => {
    expect(describe([5])).toMatchObject({ n: 1, mean: 5, median: 5, sd: null });
  });
});

suite('midRanks', () => {
  it('bağlarda ortalama sıra', () => {
    expect(midRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(midRanks([3, 1, 2])).toEqual([3, 1, 2]);
    expect(midRanks([7, 7, 7])).toEqual([2, 2, 2]);
  });
});

suite('olasılık işlevleri', () => {
  it('ki-kare sağ kuyruk: df=2 kapalı biçim e^(-x/2)', () => {
    for (const x of [0.5, 2, 4, 7.2, 15]) {
      expect(chiSquareSf(x, 2)).toBeCloseTo(Math.exp(-x / 2), 10);
    }
  });

  it('ki-kare sağ kuyruk: bilinen kritik değerler (%5)', () => {
    expect(chiSquareSf(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chiSquareSf(5.991465, 2)).toBeCloseTo(0.05, 5);
    expect(chiSquareSf(7.814728, 3)).toBeCloseTo(0.05, 5);
    expect(chiSquareSf(9.487729, 4)).toBeCloseTo(0.05, 5);
  });

  it('ki-kare sağ kuyruk: uçlar', () => {
    expect(chiSquareSf(0, 3)).toBe(1);
    expect(chiSquareSf(200, 2)).toBeLessThan(1e-40);
  });

  it('standart normal sağ kuyruk', () => {
    expect(normalSf(0)).toBeCloseTo(0.5, 12);
    expect(normalSf(1.959964)).toBeCloseTo(0.025, 6);
    expect(normalSf(3.0)).toBeCloseTo(0.0013499, 6);
    expect(normalSf(-1.959964)).toBeCloseTo(0.975, 6); // negatifte 1 - sağ kuyruk
  });
});

suite('kruskalWallis', () => {
  it('birbirinden tamamen ayrı üç grup: H = 7,2, df 2, p = e^-3,6, ε² = 0,9', () => {
    // N=9: H = 12/(9·10) · (6²/3 + 15²/3 + 24²/3) − 3·10 = 37,2 − 30
    const r = kruskalWallis([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])!;
    expect(r.h).toBeCloseTo(7.2, 10);
    expect(r.df).toBe(2);
    expect(r.p).toBeCloseTo(Math.exp(-3.6), 10);
    expect(r.epsilonSquared).toBeCloseTo(0.9, 10); // H(N+1)/(N²-1) = 72/80
  });

  it('hepsi aynı değerse H = 0, p = 1 (bağ düzeltmesi sıfıra bölmez)', () => {
    const r = kruskalWallis([
      [5, 5],
      [5, 5, 5],
    ])!;
    expect(r).toMatchObject({ h: 0, p: 1, epsilonSquared: 0 });
  });

  it('bağlı veride sıra-ANOVA ile bağımsız doğrulama: H = (N-1) · SS_gruplar / SS_toplam (ortalama sıralar)', () => {
    const groups = [
      [1, 2, 2, 5],
      [2, 3, 6],
      [4, 4, 7, 8, 9],
    ];
    const all = groups.flat();
    const ranks = midRanks(all);
    const grand = sum(ranks) / ranks.length;
    let offset = 0;
    let ssb = 0;
    for (const g of groups) {
      const r = ranks.slice(offset, offset + g.length);
      offset += g.length;
      ssb += g.length * (sum(r) / g.length - grand) ** 2;
    }
    const sst = ranks.reduce((s, r) => s + (r - grand) ** 2, 0);
    expect(kruskalWallis(groups)!.h).toBeCloseTo(((all.length - 1) * ssb) / sst, 10);
  });

  it('ikiden az grup ya da boş grup varsa null', () => {
    expect(kruskalWallis([[1, 2, 3]])).toBeNull();
    expect(kruskalWallis([[1, 2], []])).toBeNull();
    expect(kruskalWallis([])).toBeNull();
  });

  it('grupların sırası sonucu değiştirmez', () => {
    const a = kruskalWallis([
      [1, 4, 9],
      [2, 3],
      [5, 6, 7, 8],
    ])!;
    const b = kruskalWallis([
      [5, 6, 7, 8],
      [1, 4, 9],
      [2, 3],
    ])!;
    expect(a.h).toBeCloseTo(b.h, 12);
    expect(a.p).toBeCloseTo(b.p, 12);
  });
});

suite('mannWhitney', () => {
  it('tamamen ayrı küçük gruplar: U = 0, tam (exact) iki yönlü p = 2/20, Cliff δ = -1', () => {
    const r = mannWhitney([1, 2, 3], [4, 5, 6]);
    expect(r).toMatchObject({ u: 0, exact: true, cliffsDelta: -1 });
    expect(r.p).toBeCloseTo(0.1, 12);
  });

  it('yönü tersine çevirince p aynı, δ işaret değiştirir', () => {
    const r = mannWhitney([4, 5, 6], [1, 2, 3]);
    expect(r).toMatchObject({ u: 9, cliffsDelta: 1 });
    expect(r.p).toBeCloseTo(0.1, 12);
  });

  it('[1,2] ve [3,4]: tam p = 2/6', () => {
    expect(mannWhitney([1, 2], [3, 4]).p).toBeCloseTo(2 / 6, 12);
  });

  it('Cliff δ elle: [1,3] ve [2,4] → (üstün 1 − altta 3) / 4 = -0,5', () => {
    expect(mannWhitney([1, 3], [2, 4]).cliffsDelta).toBeCloseTo(-0.5, 12);
  });

  it('hepsi bağlıysa p = 1 ve δ = 0', () => {
    const r = mannWhitney([1, 1], [1, 1]);
    expect(r.p).toBe(1);
    expect(r.cliffsDelta).toBe(0);
  });

  it('bağlar tam testte yarım sayılır: [1,2,2] ve [2,3,4] için tam p elle sayımla', () => {
    // Birleşik [1,2,2,2,3,4] sıralar [1,3,3,3,5,6]; R(a) = 1+3+3 = 7, μ = 3·7/2 = 10,5, |7−10,5| = 3,5.
    // 20 altkümenin sıra toplamları: 7 (3 kez), 9 (4), 10 (3), 11 (3), 12 (4), 14 (3). Uzaklığı ≥ 3,5 olanlar
    // yalnızca 7 ve 14 → 6 altküme → p = 6/20.
    const r = mannWhitney([1, 2, 2], [2, 3, 4]);
    expect(r.exact).toBe(true);
    expect(r.p).toBeCloseTo(6 / 20, 12);
  });

  it('N > 20: normal yaklaşım (süreklilik düzeltmeli), exact = false', () => {
    const a = Array.from({ length: 11 }, (_, i) => i + 1);
    const b = Array.from({ length: 11 }, (_, i) => i + 12);
    const r = mannWhitney(a, b);
    // U = 0; σ² = 11·11·23/12; z = (60,5 − 0,5)/σ = 3,9399; p = 2 · normalSf(z) ≈ 8,2e-5
    expect(r.exact).toBe(false);
    expect(r.p).toBeGreaterThan(7.8e-5);
    expect(r.p).toBeLessThan(8.6e-5);
  });

  it('boş grup hata fırlatır', () => {
    expect(() => mannWhitney([], [1])).toThrow();
  });
});

suite('holm', () => {
  it('Holm düzeltmesi: sıralı, tekdüze, 1 ile sınırlı; sıra korunur', () => {
    // sıralı: 0,01×3 = 0,03; 0,03×2 = 0,06; 0,04×1 = 0,04 → tekdüze için 0,06
    const adjusted = holm([0.01, 0.04, 0.03]);
    [0.03, 0.06, 0.06].forEach((expected, i) => expect(adjusted[i]).toBeCloseTo(expected, 12));
    expect(holm([0.5, 0.6])).toEqual([1, 1]);
    expect(holm([0.2])).toEqual([0.2]);
    expect(holm([])).toEqual([]);
  });
});
