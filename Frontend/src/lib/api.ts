/**
 * Backend istemcisi. Yanıt zarfı: { success: true, data } | { success: false, error }.
 * Tüm hatalar ApiError olarak fırlatılır, böylece arayüz tek biçimde işleyebilir:
 *  - NETWORK_ERROR   : sunucuya ulaşılamadı (backend kapalı, ağ, CORS)
 *  - INVALID_RESPONSE: sunucu beklenen biçimde yanıt vermedi (ör. HTML hata sayfası)
 *  - diğerleri       : backend'in döndürdüğü sabit hata kodu (VALIDATION_ERROR vb.)
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export type ApiErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'HTTP_ERROR' | (string & {});

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (cause) {
    // fetch yalnızca ağ düzeyindeki hatalarda reddedilir (HTTP hata kodlarında değil).
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Sunucuya ulaşılamıyor. Backend çalışıyor mu, bağlantınız var mı?',
      undefined,
      cause,
    );
  }

  // Gövde yalnızca bir kez okunabilir: önce metin olarak alınır, sonra çözülmeye çalışılır.
  const text = await response.text();
  const body = parseJson(text) as Envelope<T> | undefined;
  const isEnvelope = typeof body === 'object' && body !== null && 'success' in body;

  if (!response.ok) {
    if (isEnvelope && body.error) {
      throw new ApiError(
        response.status,
        body.error.code ?? 'HTTP_ERROR',
        body.error.message ?? `HTTP ${response.status}`,
        body.error.requestId,
        body.error.details,
      );
    }
    throw new ApiError(
      response.status,
      'HTTP_ERROR',
      `Sunucu beklenmeyen bir yanıt verdi (HTTP ${response.status}).`,
    );
  }

  if (!isEnvelope || body.success !== true) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Sunucudan geçersiz yanıt alındı.');
  }
  return body.data as T;
}
