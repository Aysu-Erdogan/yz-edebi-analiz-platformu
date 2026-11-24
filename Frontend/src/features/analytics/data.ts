/**
 * `GET /analytics/stats` yanıtının tipleri ve ekranın kullandığı saf dönüşümler (DOM'a dokunmaz).
 * Anahtarlar backend'in yanıtıyla aynıdır (Türkçe).
 */

export interface Group {
  anahtar: string;
  n: number;
  ortalama: number;
  ortanca: number;
  sd: number | null;
  enDusuk: number;
  enYuksek: number;
}

export interface Pair {
  a: string;
  b: string;
  u: number;
  p: number;
  pHolm: number;
  cliffDelta: number;
  tam: boolean;
}

export interface Comparison {
  kapsam: string;
  gruplar: Group[];
  kruskalWallis: { h: number; sd: number; p: number; epsilonKare: number } | null;
  ikililer: Pair[];
  notlar: string[];
}

export interface Profile {
  kapsam: string;
  kriterler: string[];
  gruplar: { anahtar: string; n: number; ortalamalar: Record<string, number> }[];
}

export interface Condition {
  hakem: string;
  rubrikSurumu: string;
  hakemKomutSurumu: string | null;
  metin: number;
  elleGirilen: number;
  olculemeyen: number;
  kirilimlar: { etiket: string; gruplar: Group[] }[];
  karsilastirmalar: Comparison[];
  profiller: Profile[];
}

export interface StatsReport {
  olusturulma: string;
  kosullar: Condition[];
}

/** `GET /rubrics` yanıtından ekranın ihtiyacı olan kısım (kriter adları ve ölçek). */
export interface RubricLite {
  genre: string;
  version: string;
  scale: { min: number; max: number };
  criteria: { key: string; label: string }[];
}

const GENRE_LABELS: Record<string, string> = { siir: 'Şiir', hikaye: 'Hikâye', deneme: 'Deneme' };

export const genreLabel = (genre: string): string => GENRE_LABELS[genre] ?? genre;

/** "tür siir" → "Tür: Şiir", "tema Aşk" → "Tema: Aşk", "tüm türler" → "Tüm türler". */
export function scopeLabel(scope: string): string {
  if (scope.startsWith('tür ')) return `Tür: ${genreLabel(scope.slice(4))}`;
  if (scope.startsWith('tema ')) return `Tema: ${scope.slice(5)}`;
  return scope.charAt(0).toLocaleUpperCase('tr-TR') + scope.slice(1);
}

/** "anthropic/claude-sonnet-5-5" → "claude-sonnet-5-5" (sağlayıcı kimliği tabloda yer kaplamasın). */
export const modelName = (author: string): string => author.slice(author.indexOf('/') + 1);

/** Yazarlar (modeller), "tüm türler" kırılımındaki sırayla; renk ve işaret bu sıraya bağlıdır. */
export function authorsOf(c: Condition): string[] {
  const all = c.kirilimlar.find((b) => b.etiket === 'tüm türler');
  return (all?.gruplar ?? []).map((g) => g.anahtar);
}

export interface HeatTable {
  columns: { key: string; label: string }[];
  rows: { author: string; cells: ({ mean: number; n: number } | null)[] }[];
  min: number;
  max: number;
}

/** Model × tür ya da model × tema ortalama tablosu (`prefix`: "tür " | "tema "). */
export function heatTable(c: Condition, prefix: 'tür ' | 'tema '): HeatTable {
  const parts = c.kirilimlar.filter((b) => b.etiket.startsWith(prefix));
  const rows = authorsOf(c).map((author) => ({
    author,
    cells: parts.map((b) => {
      const g = b.gruplar.find((x) => x.anahtar === author);
      return g ? { mean: g.ortalama, n: g.n } : null;
    }),
  }));
  const values = rows.flatMap((r) => r.cells.flatMap((x) => (x ? [x.mean] : [])));
  return {
    columns: parts.map((b) => ({
      key: b.etiket.slice(prefix.length),
      label:
        prefix === 'tür '
          ? genreLabel(b.etiket.slice(prefix.length))
          : b.etiket.slice(prefix.length),
    })),
    rows,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

/**
 * Hücre koyuluğu (kakao saydamlığı), tablodaki en düşük→en yüksek değere göre 0.05–0.35.
 * Üst sınır, kakao metnin hücre üstünde 4.5:1 kontrastını korur. Sayı her zaman yazılıdır, renk ikincildir.
 */
export function heatAlpha(value: number, min: number, max: number): number {
  return max === min ? 0.2 : 0.05 + (0.3 * (value - min)) / (max - min);
}

/** Kriter anahtarından görünen ad ve ölçek üst sınırı; rubrik bulunamazsa anahtar ve 5 kullanılır. */
export function rubricLookup(
  rubrics: RubricLite[] | undefined,
  genre: string,
  version: string,
): { label: (key: string) => string; scaleMax: number } {
  const rubric = rubrics?.find((r) => r.genre === genre && r.version === version);
  const labels = new Map(rubric?.criteria.map((c) => [c.key, c.label]));
  return { label: (key) => labels.get(key) ?? key, scaleMax: rubric?.scale.max ?? 5 };
}
