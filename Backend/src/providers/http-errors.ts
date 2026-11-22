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

/** Ağ hatası: bizim iptalimiz zaman aşımıdır, geri kalanı (bağlantı kopması vb.) geçici sunucu hatasıdır. */
export function networkError(error: unknown): ProviderError {
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new ProviderError('timeout', 'İstek süresinde tamamlanamadı', { cause: error });
  }
  return new ProviderError('server_error', 'Sağlayıcıya bağlanılamadı', { cause: error });
}

/** OpenAI bakiye bitince 429 verir; tür `insufficient_quota`, kod `credit_balance_exhausted` (gerçek denemede görüldü). */
const BILLING_CODES: ReadonlySet<unknown> = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
]);

/**
 * Hata cevabının gövdesi JSON ya da düz metin/HTML olabilir; `{ error: { message, type, code } }` biçimindeki
 * iletiyi ve hata kodunu buradan çıkarır. Kod iletiye eklenir: bilinmeyen bir hatanın nedeni çıktıda görünsün.
 */
export async function httpError(response: Response): Promise<ProviderError> {
  const raw = await response.text().catch(() => '');
  let message = raw.slice(0, 200) || response.statusText || 'ayrıntı yok';
  let quota = false;
  try {
    const { error } = JSON.parse(raw) as {
      error?: { message?: string; type?: unknown; code?: unknown };
    };
    if (error?.message) message = error.message;
    const label = [error?.code, error?.type].find((v) => typeof v === 'string');
    if (label) message += ` [${label as string}]`;
    quota = [error?.code, error?.type].some((v) => BILLING_CODES.has(v));
  } catch {
    // JSON değil: düz metin kullanılır
  }
  // OpenAI "kredi kalmadı"yı da 429 ile bildirir; bu geçici bir hız sınırı değil, bakiye sorunudur: beklemek çözmez.
  if (quota) return new ProviderError('auth', `HTTP ${response.status}: ${message}`);
  return errorFromStatus(response.status, message, response.headers);
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
