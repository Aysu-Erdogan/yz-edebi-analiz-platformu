import type { ExportEvaluation } from './export.js';

/**
 * Tekrar kararlılığı (T20): aynı hakem aynı metne tekrar tekrar puan verdiğinde puanlar ne kadar oynuyor?
 * Saf işlevler: veritabanına dokunmaz. Girdi, dışa aktarmanın okuduğu puanlama kayıtlarıdır.
 *
 * Bir "grup" = aynı metin + aynı hakem + aynı rubrik sürümü + aynı hakem komutu sürümü: farklı rubrik ya da
 * komutla alınan puanlar birbirinin tekrarı sayılmaz. Bir "koşul" = aynı hakem + tür + rubrik + komut sürümü
 * (kriterler türe göre değiştiği için tür ayrıdır).
 */

/** Kayan nokta gürültüsünü (70 ile 70,0000000001) "aynı" saymak için. */
const EPS = 1e-9;

export interface TotalStats {
  mean: number;
  min: number;
  max: number;
  range: number;
  /** Örneklem standart sapması (n-1 ile). */
  sd: number;
}

export interface StabilityGroup {
  textId: number;
  genre: string;
  judge: string;
  rubricVersion: string;
  judgeTemplateVersion: string | null;
  /** Başarılı puanlama (tekrar) sayısı. */
  replicates: number;
  /** Başarısız puanlama sayısı; hesaba girmez, yalnızca sayılır. */
  failed: number;
  /** En az 2 başarılı tekrar varsa dolu; yoksa null (tek tekrarda sapma 0 değil, bilinmiyor). */
  total: TotalStats | null;
}

export interface CriterionStability {
  key: string;
  /** Tekrar sapması (s_r), kriterin ham puanı için; ölçülebilen grup yoksa null. */
  repeatabilitySd: number | null;
  /** Tüm tekrarlarda aynı puanın çıktığı grup sayısı. */
  identical: number;
  /** Bu kriteri en az iki tekrarla ölçülebilen grup sayısı. */
  cells: number;
}

export interface StabilityCondition {
  judge: string;
  genre: string;
  rubricVersion: string;
  judgeTemplateVersion: string | null;
  groups: number;
  /** En az 2 başarılı tekrarı olan grup sayısı. */
  measurable: number;
  failed: number;
  /**
   * Toplam puanın tekrar sapması s_r: grup varyanslarının serbestlik dereceleriyle (n-1) ağırlıklı
   * ortalamasının karekökü (ISO 5725 "tekrarlanabilirlik standart sapması"). Ölçülebilen grup yoksa null.
   */
  repeatabilitySd: number | null;
  meanRange: number | null;
  maxRange: number | null;
  /** Toplam puanı tüm tekrarlarda aynı çıkan grup sayısı. */
  identicalGroups: number;
  criteria: CriterionStability[];
}

export interface StabilityReport {
  conditions: StabilityCondition[];
  groups: StabilityGroup[];
}

interface Acc {
  textId: number;
  genre: string;
  judge: string;
  rubricVersion: string;
  judgeTemplateVersion: string | null;
  ok: ExportEvaluation[];
  failed: number;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

function sampleVariance(values: number[]): number {
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
}

/** Serbestlik dereceleriyle ağırlıklı birleşik standart sapma; hiç ölçüm yoksa null. */
function pooledSd(cells: { variance: number; df: number }[]): number | null {
  const df = cells.reduce((sum, c) => sum + c.df, 0);
  if (df === 0) return null;
  return Math.sqrt(cells.reduce((sum, c) => sum + c.df * c.variance, 0) / df);
}

function describe(values: number[]): TotalStats {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { mean: mean(values), min, max, range: max - min, sd: Math.sqrt(sampleVariance(values)) };
}

const byText = (a: Acc, b: Acc): number =>
  a.judge.localeCompare(b.judge) ||
  a.textId - b.textId ||
  a.rubricVersion.localeCompare(b.rubricVersion) ||
  (a.judgeTemplateVersion ?? '').localeCompare(b.judgeTemplateVersion ?? '');

export function computeStability(records: ExportEvaluation[]): StabilityReport {
  const accs = new Map<string, Acc>();
  for (const r of records) {
    const key = JSON.stringify([r.textId, r.judge, r.rubricVersion, r.judgeTemplateVersion]);
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        textId: r.textId,
        genre: r.genre,
        judge: r.judge,
        rubricVersion: r.rubricVersion,
        judgeTemplateVersion: r.judgeTemplateVersion,
        ok: [],
        failed: 0,
      };
      accs.set(key, acc);
    }
    if (r.status === 'succeeded' && r.totalScore !== null) acc.ok.push(r);
    else acc.failed++;
  }
  const sorted = [...accs.values()].sort(byText);

  const groups: StabilityGroup[] = sorted.map((a) => ({
    textId: a.textId,
    genre: a.genre,
    judge: a.judge,
    rubricVersion: a.rubricVersion,
    judgeTemplateVersion: a.judgeTemplateVersion,
    replicates: a.ok.length,
    failed: a.failed,
    total: a.ok.length >= 2 ? describe(a.ok.map((r) => r.totalScore as number)) : null,
  }));

  const byCondition = new Map<string, Acc[]>();
  for (const a of sorted) {
    const key = JSON.stringify([a.judge, a.genre, a.rubricVersion, a.judgeTemplateVersion]);
    byCondition.set(key, [...(byCondition.get(key) ?? []), a]);
  }

  const conditions = [...byCondition.values()]
    .map((members): StabilityCondition => {
      const first = members[0]!;
      const measurable = members.filter((a) => a.ok.length >= 2);
      const stats = measurable.map((a) => describe(a.ok.map((r) => r.totalScore as number)));

      const keys = new Set<string>();
      for (const a of measurable) {
        for (const r of a.ok) for (const s of r.scores) keys.add(s.criterionKey);
      }
      const criteria = [...keys].map((key): CriterionStability => {
        const cells = measurable.flatMap((a) => {
          const values = a.ok.flatMap((r) =>
            r.scores.filter((s) => s.criterionKey === key).map((s) => s.score),
          );
          return values.length >= 2 ? [values] : [];
        });
        return {
          key,
          repeatabilitySd: pooledSd(
            cells.map((v) => ({ variance: sampleVariance(v), df: v.length - 1 })),
          ),
          identical: cells.filter((v) => Math.max(...v) - Math.min(...v) < EPS).length,
          cells: cells.length,
        };
      });

      return {
        judge: first.judge,
        genre: first.genre,
        rubricVersion: first.rubricVersion,
        judgeTemplateVersion: first.judgeTemplateVersion,
        groups: members.length,
        measurable: measurable.length,
        failed: members.reduce((sum, a) => sum + a.failed, 0),
        repeatabilitySd: pooledSd(
          measurable.map((a) => ({
            variance: sampleVariance(a.ok.map((r) => r.totalScore as number)),
            df: a.ok.length - 1,
          })),
        ),
        meanRange: stats.length ? mean(stats.map((s) => s.range)) : null,
        maxRange: stats.length ? Math.max(...stats.map((s) => s.range)) : null,
        identicalGroups: stats.filter((s) => s.range < EPS).length,
        criteria,
      };
    })
    .sort(
      (a, b) =>
        a.judge.localeCompare(b.judge) ||
        a.genre.localeCompare(b.genre) ||
        a.rubricVersion.localeCompare(b.rubricVersion) ||
        (a.judgeTemplateVersion ?? '').localeCompare(b.judgeTemplateVersion ?? ''),
    );

  return { conditions, groups };
}

const fixed = (value: number | null): string => (value === null ? '-' : value.toFixed(2));

/** Ekran çıktısı: satır satır. Eşik yoktur, yalnızca ham sayılar yazılır. */
export function formatStability(report: StabilityReport): string[] {
  if (report.conditions.length === 0) return ['Uyarı: hiç puanlama kaydı yok.'];
  const lines = ['Tekrar kararlılığı: aynı metin, aynı hakem, aynı rubrik ve komut sürümü'];
  for (const c of report.conditions) {
    lines.push(
      `Koşul: ${c.judge} · ${c.genre} · rubrik ${c.rubricVersion} · hakem komutu ${c.judgeTemplateVersion ?? 'bilinmiyor'}`,
      `  Metin: ${c.groups} (ölçülebilen ${c.measurable}, ölçülemeyen ${c.groups - c.measurable}) · başarısız puanlama: ${c.failed}`,
    );
    if (c.measurable === 0) {
      lines.push('  Sapma ölçülemedi: hiçbir metinde en az 2 başarılı tekrar yok.');
      continue;
    }
    lines.push(
      `  Toplam puan: tekrar sapması (s_r) ${fixed(c.repeatabilitySd)} · ortalama aralık ${fixed(c.meanRange)} · en büyük aralık ${fixed(c.maxRange)} · tamamen aynı çıkan metin ${c.identicalGroups}/${c.measurable}`,
    );
    const cells = c.criteria.reduce((sum, k) => sum + k.cells, 0);
    const identical = c.criteria.reduce((sum, k) => sum + k.identical, 0);
    if (cells > 0) {
      lines.push(
        `  Kriterler: tamamen aynı çıkan hücre ${identical}/${cells} (%${((100 * identical) / cells).toFixed(1)})`,
      );
      for (const k of c.criteria) {
        lines.push(
          `    ${k.key}: s_r ${fixed(k.repeatabilitySd)}, tamamen aynı ${k.identical}/${k.cells}`,
        );
      }
    }
  }
  return lines;
}

/** JSON dosyası: Türkçe anahtarlar (dışa aktarma JSON'uyla aynı dil). */
export function stabilityJson(report: StabilityReport, now: Date): string {
  return JSON.stringify(
    {
      olusturulma: now.toISOString(),
      kosullar: report.conditions.map((c) => ({
        hakem: c.judge,
        tur: c.genre,
        rubrikSurumu: c.rubricVersion,
        hakemKomutSurumu: c.judgeTemplateVersion,
        grupSayisi: c.groups,
        olculebilenGrup: c.measurable,
        basarisizPuanlama: c.failed,
        tekrarSapmasi: c.repeatabilitySd,
        ortalamaAralik: c.meanRange,
        enBuyukAralik: c.maxRange,
        tamamenAyniGrup: c.identicalGroups,
        kriterler: c.criteria.map((k) => ({
          kriter: k.key,
          tekrarSapmasi: k.repeatabilitySd,
          ayniHucre: k.identical,
          hucre: k.cells,
        })),
      })),
      gruplar: report.groups.map((g) => ({
        metinId: g.textId,
        tur: g.genre,
        hakem: g.judge,
        rubrikSurumu: g.rubricVersion,
        hakemKomutSurumu: g.judgeTemplateVersion,
        tekrar: g.replicates,
        basarisiz: g.failed,
        ortalama: g.total?.mean ?? null,
        enDusuk: g.total?.min ?? null,
        enYuksek: g.total?.max ?? null,
        aralik: g.total?.range ?? null,
        standartSapma: g.total?.sd ?? null,
      })),
    },
    null,
    2,
  );
}
