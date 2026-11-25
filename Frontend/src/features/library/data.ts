/**
 * `GET /texts` ve `GET /texts/:id` sözleşmesi ve ekranın kullandığı saf yardımcılar (DOM'a dokunmaz).
 * Anahtarlar backend'in yanıtıyla aynıdır (docs/openapi.yaml).
 */

export type Source = 'generated' | 'manual';

export const SOURCE_LABEL: Record<Source, string> = {
  generated: 'Üretilen',
  manual: 'Elle girilen',
};

export interface TextAuthor {
  provider: string;
  modelId: string;
  displayName: string;
}

export interface TextSummary {
  id: number;
  genre: string;
  theme: string;
  source: Source;
  /** Elle girilen metinde kullanıcının verdiği etiket. */
  label: string | null;
  author: TextAuthor | null;
  wordCount: number;
  excerpt: string;
  createdAt: string;
  /** Başarılı puanlama sayısı (tüm hakemler, tekrarlar dahil). */
  succeededEvaluations: number;
}

export interface TextScore {
  key: string;
  label: string;
  score: number;
  comment: string | null;
}

export interface TextEvaluation {
  id: number;
  judge: string;
  rubricVersion: string;
  templateVersion: string | null;
  replicateNo: number;
  status: string;
  error: string | null;
  /** Ağırlıklı toplam, 0-100; başarısızsa null. */
  totalScore: number | null;
  scores: TextScore[];
  createdAt: string;
}

export interface TextDetail extends Omit<TextSummary, 'excerpt'> {
  body: string;
  generation: {
    templateVersion: string;
    replicateNo: number;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
  } | null;
  evaluations: TextEvaluation[];
}

export interface Filters {
  genre: string;
  theme: string;
  source: string;
}

export const NO_FILTERS: Filters = { genre: '', theme: '', source: '' };

export const hasFilters = (f: Filters): boolean => Boolean(f.genre || f.theme || f.source);

/** Boş süzgeçler sorguya yazılmaz; hiç süzgeç yoksa boş dize. */
export function buildQuery(filters: Filters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Metni yazanın görünen adı: üretilende model, elle girilende etiket; ikisi de yoksa "Etiketsiz". */
export const writerName = (t: { author: TextAuthor | null; label: string | null }): string =>
  t.author?.displayName ?? t.label ?? 'Etiketsiz';

export const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export interface EvaluationGroup {
  key: string;
  judge: string;
  rubricVersion: string;
  templateVersion: string | null;
  /** Tekrar numarasına göre sıralı, başarısızlar dahil. */
  replicates: TextEvaluation[];
  succeeded: TextEvaluation[];
  /** Başarılı tekrarların toplam puan ortalaması; başarılı yoksa null. */
  meanTotal: number | null;
  /** Kriter başına ham puan ortalaması (başarılı tekrarlar), ilk başarılı tekrarın kriter sırasıyla. */
  criteria: { key: string; label: string; mean: number }[];
}

/**
 * Puanlamaları koşula göre gruplar: aynı hakem, rubrik sürümü ve komut sürümü. Koşullar ilk görüldükleri
 * sırayla gelir. Farklı koşulların puanları birbirine karıştırılmaz (raporun 3.12 ilkesi).
 */
export function groupEvaluations(evaluations: TextEvaluation[]): EvaluationGroup[] {
  const groups = new Map<string, TextEvaluation[]>();
  for (const e of evaluations) {
    const key = JSON.stringify([e.judge, e.rubricVersion, e.templateVersion]);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([key, all]) => {
    const replicates = [...all].sort((a, b) => a.replicateNo - b.replicateNo || a.id - b.id);
    const succeeded = replicates.filter((e) => e.status === 'succeeded' && e.totalScore !== null);
    const first = succeeded[0];
    return {
      key,
      judge: all[0]!.judge,
      rubricVersion: all[0]!.rubricVersion,
      templateVersion: all[0]!.templateVersion,
      replicates,
      succeeded,
      meanTotal: mean(succeeded.map((e) => e.totalScore as number)),
      criteria: (first?.scores ?? []).map((c) => ({
        key: c.key,
        label: c.label,
        mean: mean(
          succeeded.flatMap((e) => e.scores.filter((s) => s.key === c.key).map((s) => s.score)),
        ) as number,
      })),
    };
  });
}
