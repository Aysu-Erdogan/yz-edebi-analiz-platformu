/**
 * İstatistik çekirdeği: betimsel değerler, Kruskal-Wallis, Mann-Whitney (küçük örneklemde tam test), Cliff δ,
 * Holm düzeltmesi. Saf işlevler, harici kütüphane yok (SciPy/R bu ortamda yok); doğruluk kapalı biçimli
 * değerlerle ve bağımsız formüllerle testlerde sınanır.
 */

export interface Descriptive {
  n: number;
  mean: number;
  median: number;
  /** Örneklem standart sapması (n-1); tek değerde null. */
  sd: number | null;
  min: number;
  max: number;
}

export const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

export function describe(values: number[]): Descriptive {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const m = mean(values);
  return {
    n,
    mean: m,
    median: n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2,
    sd: n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : null,
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

/** Sıralar (1'den başlar); bağlarda ortalama sıra. Sıra girdi sırasıyla aynıdır. */
export function midRanks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Σ(t³ − t) bağ grupları üzerinden (bağ düzeltmesi için). */
function tieTerm(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let sum = 0;
  for (const t of counts.values()) sum += t ** 3 - t;
  return sum;
}

function gammaLn(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const y = x - 1;
  let a = c[0]!;
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Düzenlenmiş üst eksik gama Q(a, x) (Numerical Recipes: seri ve sürekli kesir). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - gammaLn(a));
  if (x < a + 1) {
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * front;
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return front * h;
}

/** Ki-kare dağılımının sağ kuyruk olasılığı P(X ≥ x). */
export const chiSquareSf = (x: number, df: number): number => gammaQ(df / 2, x / 2);

/** Standart normal sağ kuyruk P(Z ≥ z). */
export function normalSf(z: number): number {
  const tail = 0.5 * gammaQ(0.5, (z * z) / 2); // erfc(|z|/√2) / 2
  return z >= 0 ? tail : 1 - tail;
}

export interface KruskalResult {
  h: number;
  df: number;
  /** Ki-kare yaklaşımıyla p (küçük gruplarda yaklaşıktır). */
  p: number;
  /** ε² = H (N + 1) / (N² − 1): 0-1 arası etki büyüklüğü. */
  epsilonSquared: number;
}

/** Bağ düzeltmeli Kruskal-Wallis. En az iki dolu grup gerekir; yoksa null. */
export function kruskalWallis(groups: number[][]): KruskalResult | null {
  if (groups.length < 2 || groups.some((g) => g.length === 0)) return null;
  const all = groups.flat();
  const n = all.length;
  const ranks = midRanks(all);
  let offset = 0;
  let sumTerm = 0;
  for (const g of groups) {
    const rankSum = ranks.slice(offset, offset + g.length).reduce((a, b) => a + b, 0);
    offset += g.length;
    sumTerm += rankSum ** 2 / g.length;
  }
  const correction = 1 - tieTerm(all) / (n ** 3 - n);
  const h = correction === 0 ? 0 : ((12 / (n * (n + 1))) * sumTerm - 3 * (n + 1)) / correction;
  const df = groups.length - 1;
  return {
    h,
    df,
    p: h === 0 ? 1 : chiSquareSf(h, df),
    epsilonSquared: (h * (n + 1)) / (n * n - 1),
  };
}

export interface MannWhitneyResult {
  /** İlk grubun U değeri (ikinciye göre üstün gelme sayısı, bağlar yarım). */
  u: number;
  /** İki yönlü p. */
  p: number;
  /** true: tüm permütasyonlar sayılarak (N ≤ 20), false: normal yaklaşım. */
  exact: boolean;
  /** Cliff δ = (üstün − altta) / (n1·n2); +1: ilk grup hep yüksek, −1: hep düşük. */
  cliffsDelta: number;
}

const EXACT_LIMIT = 20;

/** İki yönlü tam p: sıra toplamı ortadan en az gözlenen kadar uzakta olan altküme oranı. */
function exactPermutationP(ranks: number[], n1: number, observed: number): number {
  const total = ranks.length;
  const center = (n1 * (total + 1)) / 2;
  const threshold = Math.abs(observed - center) - 1e-9;
  let all = 0;
  let extreme = 0;
  const walk = (start: number, left: number, sum: number): void => {
    if (left === 0) {
      all++;
      if (Math.abs(sum - center) >= threshold) extreme++;
      return;
    }
    for (let i = start; i <= total - left; i++) walk(i + 1, left - 1, sum + ranks[i]!);
  };
  walk(0, n1, 0);
  return extreme / all;
}

export function mannWhitney(a: number[], b: number[]): MannWhitneyResult {
  if (a.length === 0 || b.length === 0)
    throw new Error('Mann-Whitney için iki grup da dolu olmalı');
  const n1 = a.length;
  const n2 = b.length;
  const n = n1 + n2;
  const all = [...a, ...b];
  const ranks = midRanks(all);
  const rankSum = ranks.slice(0, n1).reduce((x, y) => x + y, 0);
  const u = rankSum - (n1 * (n1 + 1)) / 2;
  const cliffsDelta = (2 * u) / (n1 * n2) - 1;

  if (n <= EXACT_LIMIT) {
    return { u, p: exactPermutationP(ranks, n1, rankSum), exact: true, cliffsDelta };
  }
  const variance = ((n1 * n2) / 12) * (n + 1 - tieTerm(all) / (n * (n - 1)));
  if (variance === 0) return { u, p: 1, exact: false, cliffsDelta };
  const z = (Math.abs(u - (n1 * n2) / 2) - 0.5) / Math.sqrt(variance);
  return { u, p: Math.min(1, 2 * normalSf(Math.max(z, 0))), exact: false, cliffsDelta };
}

/** Holm düzeltmesi: girdi sırası korunur, tekdüze ve 1 ile sınırlı. */
export function holm(pValues: number[]): number[] {
  const order = pValues.map((p, i) => [p, i] as const).sort((x, y) => x[0] - y[0]);
  const adjusted = new Array<number>(pValues.length);
  let running = 0;
  order.forEach(([p, index], rank) => {
    running = Math.max(running, Math.min(1, (pValues.length - rank) * p));
    adjusted[index] = running;
  });
  return adjusted;
}
