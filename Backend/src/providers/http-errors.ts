import { ProviderError, type ProviderErrorKind } from './provider.js';

interface HeadersLike {
  get(name: string): string | null;
}

/** Retry-After (saniye) ya da retry-after-ms (milisaniye) başlığını milisaniyeye çevirir; yoksa tanımsız. */
export function retryAfterMs(headers: HeadersLike | undefined): number | undefined {
  const read = (name: string): number | undefined => {
    const raw = headers?.get(name);
    if (raw == null || raw.trim() === '') return undefined;
    const value = Number(raw); // tarih biçimi (HTTP-date) sayı değildir, yok sayılır
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const ms = read('retry-after-ms');
  if (ms !== undefined) return ms;
  const seconds = read('retry-after');
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

function kindFor(status: number): ProviderErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server_error'; // 529 (Anthropic "aşırı yüklü") dahil
  if (status === 401 || status === 402 || status === 403) return 'auth'; // 402: bakiye bitti
  return 'invalid_request';
}

/** Sağlayıcının HTTP hata cevabını ortak hata türüne çevirir (hangisinin yeniden deneneceği buradan gelir). */
export function errorFromStatus(
  status: number,
  message: string,
  headers?: HeadersLike,
): ProviderError {
  return new ProviderError(kindFor(status), `HTTP ${status}: ${message}`, {
    retryAfterMs: retryAfterMs(headers),
  });
}
