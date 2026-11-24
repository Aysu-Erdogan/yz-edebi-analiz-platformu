import type { ExportEvaluation } from './export.js';
import {
  describe,
  holm,
  kruskalWallis,
  mannWhitney,
  mean,
  type Descriptive,
  type KruskalResult,
} from './stats.js';

/**
 * Model karşılaştırması: puanlama kayıtlarından yazar modellere göre betimsel değerler, Kruskal-Wallis ve ikili
 * Mann-Whitney (Holm düzeltmeli, Cliff δ). Ölçüm birimi **metin**dir: bir metnin puanı, aynı hakemin başarılı
 * tekrarlarının toplam puan ortalamasıdır. Bir "koşul" = aynı hakem + rubrik sürümü + hakem komutu sürümü;
 * koşullar ayrı analiz edilir. Saf işlevler, veritabanına dokunmaz.
 */

export interface GroupSummary extends Descriptive {
  key: string;
}

export interface Breakdown {
  label: string;
  groups: GroupSummary[];
}

export interface PairResult {
  a: string;
  b: string;
  u: number;
  p: number;
  pHolm: number;
  cliffsDelta: number;
  exact: boolean;
}

export interface Comparison {
  scope: string;
  groups: GroupSummary[];
  kruskal: KruskalResult | null;
  pairs: PairResult[];
  notes: string[];
}

export interface ProfileGroup {
  key: string;
  /** Bu yazarın bu kapsamdaki metin sayısı. */
  n: number;
  /** Kriter anahtarı → ham puan ortalaması (önce metin içinde tekrarlar, sonra metinler ortalanır). */
  means: Record<string, number>;
}

/** Radar grafiği için: bir türde yazar başına kriter ortalamaları (kriterler türe göre farklıdır). */
export interface Profile {
  scope: string;
  criteria: string[];
  groups: ProfileGroup[];
}

export interface AnalysisCondition {
  judge: string;
  rubricVersion: string;
  judgeTemplateVersion: string | null;
  texts: number;
  /** Yazarı olmayan (elle girilen) metinler: karşılaştırmaya girmez. */
  manualTexts: number;
  /** Yazarı belli ama hiç başarılı puanı olmayan metinler. */
  unmeasuredTexts: number;
  breakdowns: Breakdown[];
  comparisons: Comparison[];
  profiles: Profile[];
}

interface Measured {
  genre: string;
  theme: string;
  author: string;
  score: number;
  /** Kriter anahtarı → bu metnin ham puan ortalaması (başarılı tekrarlar üzerinden). */
  criteria: Record<string, number>;
}

const MIN_PER_GROUP = 2;
const COMFORTABLE_PER_GROUP = 5;

const sortBy = <T>(items: T[], key: (item: T) => string): T[] =>
  [...items].sort((x, y) => key(x).localeCompare(key(y)));

function groupBy(measured: Measured[]): GroupSummary[] {
  const byAuthor = new Map<string, number[]>();
  for (const m of measured) byAuthor.set(m.author, [...(byAuthor.get(m.author) ?? []), m.score]);
  return sortBy([...byAuthor.entries()], ([key]) => key).map(([key, scores]) => ({
    key,
    ...describe(scores),
  }));
}

function profile(scope: string, measured: Measured[]): Profile {
  const criteria = [...new Set(measured.flatMap((m) => Object.keys(m.criteria)))];
  const byAuthor = new Map<string, Measured[]>();
  for (const m of measured) byAuthor.set(m.author, [...(byAuthor.get(m.author) ?? []), m]);
  const groups = sortBy([...byAuthor.entries()], ([key]) => key).map(([key, texts]) => ({
    key,
    n: texts.length,
    means: Object.fromEntries(
      criteria.flatMap((k) => {
        const values = texts.flatMap((t) => (k in t.criteria ? [t.criteria[k]!] : []));
        return values.length ? [[k, mean(values)]] : [];
      }),
    ),
  }));
  return { scope, criteria, groups };
}

function compare(scope: string, measured: Measured[]): Comparison {
  const groups = groupBy(measured);
  const scores = (key: string): number[] =>
    measured.filter((m) => m.author === key).map((m) => m.score);
  const notes: string[] = [];
  const eligible = groups.filter((g) => g.n >= MIN_PER_GROUP);

  let kruskal: KruskalResult | null = null;
  if (groups.length >= 2 && eligible.length === groups.length) {
    kruskal = kruskalWallis(groups.map((g) => scores(g.key)));
    if (groups.some((g) => g.n < COMFORTABLE_PER_GROUP)) {
      notes.push('Grup başına 5 metinden az: Kruskal-Wallis ki-kare yaklaşımı güvenilir değil');
    }
  } else {
    notes.push(
      `Kruskal-Wallis yapılamadı, yetersiz örnek: her yazar için en az ${MIN_PER_GROUP} metin gerekir`,
    );
  }

  const raw: Omit<PairResult, 'pHolm'>[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i]!.key;
      const b = eligible[j]!.key;
      const r = mannWhitney(scores(a), scores(b));
      raw.push({ a, b, u: r.u, p: r.p, cliffsDelta: r.cliffsDelta, exact: r.exact });
    }
  }
  const adjusted = holm(raw.map((r) => r.p));
  const pairs = raw.map((r, i) => ({ ...r, pHolm: adjusted[i]! }));
  return { scope, groups, kruskal, pairs, notes };
}

export function analyze(records: ExportEvaluation[]): AnalysisCondition[] {
  const byCondition = new Map<string, ExportEvaluation[]>();
  for (const r of records) {
    const key = JSON.stringify([r.judge, r.rubricVersion, r.judgeTemplateVersion]);
    byCondition.set(key, [...(byCondition.get(key) ?? []), r]);
  }

  return sortBy(
    [...byCondition.values()].map((rows): AnalysisCondition => {
      const first = rows[0]!;
      const byText = new Map<number, ExportEvaluation[]>();
      for (const r of rows) byText.set(r.textId, [...(byText.get(r.textId) ?? []), r]);

      let manualTexts = 0;
      let unmeasuredTexts = 0;
      const measured: Measured[] = [];
      for (const textRows of byText.values()) {
        const head = textRows[0]!;
        if (head.author === null) {
          manualTexts++;
          continue;
        }
        const succeeded = textRows.filter((r) => r.status === 'succeeded' && r.totalScore !== null);
        if (succeeded.length === 0) {
          unmeasuredTexts++;
          continue;
        }
        const perCriterion = new Map<string, number[]>();
        for (const r of succeeded) {
          for (const s of r.scores) {
            perCriterion.set(s.criterionKey, [
              ...(perCriterion.get(s.criterionKey) ?? []),
              s.score,
            ]);
          }
        }
        measured.push({
          genre: head.genre,
          theme: head.theme,
          author: `${head.author.provider}/${head.author.modelId}`,
          score: mean(succeeded.map((r) => r.totalScore as number)),
          criteria: Object.fromEntries([...perCriterion].map(([k, v]) => [k, mean(v)])),
        });
      }

      const genres = [...new Set(measured.map((m) => m.genre))].sort((x, y) => x.localeCompare(y));
      const themes = [...new Set(measured.map((m) => m.theme))].sort((x, y) => x.localeCompare(y));
      return {
        judge: first.judge,
        rubricVersion: first.rubricVersion,
        judgeTemplateVersion: first.judgeTemplateVersion,
        texts: byText.size,
        manualTexts,
        unmeasuredTexts,
        breakdowns: [
          { label: 'tüm türler', groups: groupBy(measured) },
          ...genres.map((g) => ({
            label: `tür ${g}`,
            groups: groupBy(measured.filter((m) => m.genre === g)),
          })),
          ...themes.map((t) => ({
            label: `tema ${t}`,
            groups: groupBy(measured.filter((m) => m.theme === t)),
          })),
        ],
        comparisons: [
          compare('tüm türler', measured),
          ...genres.map((g) =>
            compare(
              `tür ${g}`,
              measured.filter((m) => m.genre === g),
            ),
          ),
        ],
        profiles: genres.map((g) =>
          profile(
            `tür ${g}`,
            measured.filter((m) => m.genre === g),
          ),
        ),
      };
    }),
    (c) => `${c.judge}|${c.rubricVersion}|${c.judgeTemplateVersion ?? ''}`,
  );
}

const f1 = (v: number | null): string => (v === null ? '-' : v.toFixed(1));
const signed2 = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/** Ekran çıktısı. Eşik ya da "anlamlı" yargısı yoktur: ham sayılar yazılır. */
export function formatAnalysis(conditions: AnalysisCondition[]): string[] {
  if (conditions.length === 0) return ['Uyarı: hiç puanlama kaydı yok.'];
  const lines = [
    'Model karşılaştırması: ölçüm birimi metin (tekrarlar ortalanır), yazar modele göre',
  ];
  for (const c of conditions) {
    lines.push(
      `Koşul: ${c.judge} · rubrik ${c.rubricVersion} · hakem komutu ${c.judgeTemplateVersion ?? 'bilinmiyor'}`,
      `  ${c.texts} metin (elle girilen ${c.manualTexts}, ölçülemeyen ${c.unmeasuredTexts})`,
    );
    for (const cmp of c.comparisons) {
      lines.push(`  [${cmp.scope}]`);
      lines.push(...groupLines(cmp.groups));
      if (cmp.kruskal) {
        const k = cmp.kruskal;
        lines.push(
          `    Kruskal-Wallis: H ${k.h.toFixed(2)} (sd ${k.df}) · p ${k.p.toFixed(4)} · ε² ${k.epsilonSquared.toFixed(2)}`,
        );
      }
      for (const p of cmp.pairs) {
        lines.push(
          `    ${p.a} ↔ ${p.b}: p ${p.p.toFixed(4)} (Holm ${p.pHolm.toFixed(4)}) · Cliff δ ${signed2(p.cliffsDelta)} · ${p.exact ? 'tam test' : 'yaklaşık test'}`,
        );
      }
      for (const note of cmp.notes) lines.push(`    Not: ${note}`);
    }
    for (const b of c.breakdowns.filter((x) => x.label.startsWith('tema '))) {
      lines.push(`  [${b.label}] (yalnızca betimsel)`, ...groupLines(b.groups));
    }
  }
  return lines;
}

function groupLines(groups: GroupSummary[]): string[] {
  return groups.map(
    (g) =>
      `    ${g.key}: n ${g.n} · ort ${f1(g.mean)} · ortanca ${f1(g.median)} · sd ${f1(g.sd)} · en düşük ${f1(g.min)} · en yüksek ${f1(g.max)}`,
  );
}

const groupJson = (g: GroupSummary) => ({
  anahtar: g.key,
  n: g.n,
  ortalama: g.mean,
  ortanca: g.median,
  sd: g.sd,
  enDusuk: g.min,
  enYuksek: g.max,
});

/** `--tema` ve `?tema=` süzgeci: virgülle ayrılmış temalar; tanımsız ya da boşsa süzgeç yoktur. */
export function filterThemes(
  records: ExportEvaluation[],
  raw: string | undefined,
): ExportEvaluation[] {
  const themes = raw
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return themes?.length ? records.filter((r) => themes.includes(r.theme)) : records;
}

/** Türkçe anahtarlı rapor nesnesi (dışa aktarma JSON'uyla aynı dil); dosya ve API aynı biçimi kullanır. */
export function analysisReport(conditions: AnalysisCondition[], now: Date) {
  return {
    olusturulma: now.toISOString(),
    kosullar: conditions.map((c) => ({
      hakem: c.judge,
      rubrikSurumu: c.rubricVersion,
      hakemKomutSurumu: c.judgeTemplateVersion,
      metin: c.texts,
      elleGirilen: c.manualTexts,
      olculemeyen: c.unmeasuredTexts,
      kirilimlar: c.breakdowns.map((b) => ({
        etiket: b.label,
        gruplar: b.groups.map(groupJson),
      })),
      karsilastirmalar: c.comparisons.map((cmp) => ({
        kapsam: cmp.scope,
        gruplar: cmp.groups.map(groupJson),
        kruskalWallis: cmp.kruskal && {
          h: cmp.kruskal.h,
          sd: cmp.kruskal.df,
          p: cmp.kruskal.p,
          epsilonKare: cmp.kruskal.epsilonSquared,
        },
        ikililer: cmp.pairs.map((p) => ({
          a: p.a,
          b: p.b,
          u: p.u,
          p: p.p,
          pHolm: p.pHolm,
          cliffDelta: p.cliffsDelta,
          tam: p.exact,
        })),
        notlar: cmp.notes,
      })),
      profiller: c.profiles.map((p) => ({
        kapsam: p.scope,
        kriterler: p.criteria,
        gruplar: p.groups.map((g) => ({ anahtar: g.key, n: g.n, ortalamalar: g.means })),
      })),
    })),
  };
}

/** JSON dosyası: `analysisReport` girintili metin olarak. */
export function analysisJson(conditions: AnalysisCondition[], now: Date): string {
  return JSON.stringify(analysisReport(conditions, now), null, 2);
}
