/** Kütüphane görünümü için saf yardımcılar: sözcük sayısı ve liste özeti. */

/** Boşluğa göre bölünen sözcük sayısı (bölüm 4.10'daki sayımla aynı yöntem). */
export const wordCount = (body: string): number => body.split(/\s+/).filter(Boolean).length;

/** Satır sonları tek boşluğa indirilmiş, en çok `max` karakterlik özet; kesilmişse "…" ile biter. */
export function excerpt(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max).join('').trimEnd()}…`;
}
