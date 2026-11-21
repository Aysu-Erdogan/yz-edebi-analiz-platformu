import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type JsonRequest,
  type JsonResult,
  type LLMProvider,
} from './provider.js';

export interface ResilienceOptions {
  /** Toplam deneme sayısı (ilk deneme dahil). */
  maxAttempts?: number;
  /** İlk bekleme; her denemede ikiye katlanır. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Tek bir denemenin süre sınırı. */
  timeoutMs?: number;
  /** Testlerde beklemeden geçmek için. */
  sleep?: (ms: number) => Promise<void>;
}

const defaults = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  timeoutMs: 60_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** Tek bir denemeyi süre sınırıyla çalıştırır; süre dolarsa isteği iptal eder ve `timeout` hatası verir. */
async function attempt<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError('timeout', `Sağlayıcı ${timeoutMs} ms içinde cevap vermedi`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ortak HTTP davranışı: her sağlayıcı (Claude, Gemini, Mock) bununla sarılır.
 * Geçici hatalar (kota, zaman aşımı, 5xx) üstel geri çekilmeyle yeniden denenir; kalıcı hatalar
 * ve bozuk cevaplar denenmez. Deneme hakkı bitince son hata aynen fırlatılır (sahte cevap yok, ADR 0004).
 *
 * shortcut: bekleme rastgele sapmasız (jitter yok), iş sırayla çalıştığı için yeterli; birçok iş aynı anda
 * kota duvarına çarpmaya başlarsa jitter eklenir.
 */
export function withResilience(
  provider: LLMProvider,
  options: ResilienceOptions = {},
): LLMProvider {
  const { maxAttempts, baseDelayMs, maxDelayMs, timeoutMs, sleep } = { ...defaults, ...options };

  async function run<R>(call: (signal: AbortSignal) => Promise<R>): Promise<R> {
    for (let n = 1; ; n++) {
      try {
        return await attempt(call, timeoutMs);
      } catch (error) {
        if (!(error instanceof ProviderError) || !error.retryable || n >= maxAttempts) throw error;
        const backoff = baseDelayMs * 2 ** (n - 1);
        await sleep(Math.min(maxDelayMs, Math.max(backoff, error.retryAfterMs ?? 0)));
      }
    }
  }

  return {
    id: provider.id,
    generateText: (request: GenerateRequest): Promise<GenerateResult> =>
      run((signal) => provider.generateText({ ...request, signal })),
    generateJson: <T>(request: JsonRequest<T>): Promise<JsonResult<T>> =>
      run((signal) => provider.generateJson({ ...request, signal })),
  };
}
