import type { z } from 'zod';

export const PROVIDER_IDS = ['openai', 'anthropic', 'google', 'deepseek', 'mock'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface GenerateRequest {
  /** Sağlayıcıdaki model kimliği (kayıtlı model listesinden gelir, koda gömülmez). */
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Zaman aşımında iptal sinyali verilir; adaptörler bunu HTTP isteğine geçirmelidir (fetch'in `signal`ı). */
  signal?: AbortSignal;
}

export interface JsonRequest<T> extends GenerateRequest {
  /** Cevap bu şemaya uymak zorunda; uymazsa `invalid_output` hatası fırlatılır. */
  schema: z.ZodType<T>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface GenerateResult extends Usage {
  text: string;
}

export interface JsonResult<T> extends Usage {
  data: T;
}

/** Tüm sağlayıcı adaptörlerinin (Claude, Gemini, OpenAI, DeepSeek, Mock) uyduğu ortak sözleşme. */
export interface LLMProvider {
  readonly id: ProviderId;
  generateText(request: GenerateRequest): Promise<GenerateResult>;
  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
}

export type ProviderErrorKind =
  | 'rate_limit' // 429, kota
  | 'timeout'
  | 'server_error' // 5xx
  | 'auth' // anahtar geçersiz
  | 'invalid_request'
  | 'safety_blocked' // güvenlik filtresi
  | 'empty_output'
  | 'invalid_output'; // JSON bozuk ya da şemaya uymuyor

/** Yalnızca geçici hatalar yeniden denenir; kalıcı hatayı tekrarlamak boşuna kota harcar. */
const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set([
  'rate_limit',
  'timeout',
  'server_error',
]);

export const isRetryableKind = (kind: ProviderErrorKind): boolean => RETRYABLE.has(kind);

export class ProviderError extends Error {
  readonly retryable: boolean;
  /** Sağlayıcı "şu kadar sonra tekrar dene" dediyse (Retry-After başlığı) milisaniye cinsinden. */
  readonly retryAfterMs: number | undefined;

  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    options: ErrorOptions & { retryAfterMs?: number } = {},
  ) {
    super(message, options);
    this.name = 'ProviderError';
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Yaklaşık token sayımı (dört karakter bir token): gerçek sayımı sağlayıcı verir; tahmin ve Mock için. */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

/** Boş ya da metin olmayan cevabı kabul etmez: "undefined" gibi sahte metin kaydedilmez (ADR 0004). */
export function requireText(text: unknown): string {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ProviderError(
      'empty_output',
      'Model boş cevap verdi (güvenlik filtresi ya da sağlayıcı hatası olabilir)',
    );
  }
  return text;
}

/**
 * Modelin JSON cevabını şemaya göre doğrular. Hata mesajı yalnızca alan yollarını söyler,
 * modelin cevabı mesaja sızmaz (günlüklere ve hata kayıtlarına gitmesin).
 */
export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ProviderError('invalid_output', 'Model cevabı geçerli JSON değil', { cause });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(kök)').join(', ');
    throw new ProviderError('invalid_output', `Model cevabı beklenen biçime uymuyor: ${fields}`);
  }
  return parsed.data;
}
