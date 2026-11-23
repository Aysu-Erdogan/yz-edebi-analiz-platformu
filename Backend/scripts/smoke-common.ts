import { EnvError, loadEnv } from '../src/config/env.js';
import { AnthropicProvider } from '../src/providers/anthropic-provider.js';
import { DeepSeekProvider } from '../src/providers/deepseek-provider.js';
import { GoogleProvider } from '../src/providers/google-provider.js';
import { OpenAIProvider } from '../src/providers/openai-provider.js';
import type { LLMProvider } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';

/** `llm:smoke` ve `judge:smoke` için ortak parçalar: hedef, fiyat tablosu, ipuçları, sağlayıcıların kurulumu. */

export interface SmokeTarget {
  label: string;
  provider: LLMProvider;
  model: string;
  /** Çıktıya sızmasın diye hata iletilerinden silinir. */
  secret: string;
  /** Milyon token başına [girdi, çıktı] dolar; bilinmiyorsa maliyet yazılmaz. */
  price?: [number, number];
}

/** Milyon token başına [girdi, çıktı] dolar. Okunma tarihleri ve kaynaklar: docs/PROJE_BITIRME_RAPORU.md bölüm 5. */
export const PRICES: Readonly<Record<string, [number, number]>> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  // gemini-3.8-flash ve 3.6-flash: 31 Aralık 2026'ya kadar bu fiyat, 1 Ocak 2027'den sonra [1.5, 7.5] (ADR 0010).
  'gemini-3.6-flash': [0.75, 3.75],
  'gemini-3.8-flash': [0.75, 3.75],
  'gemini-4-hydrogen': [1.5, 7.5], // zam tarihi belgede yok (22 Kas 2026)
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-terra': [1, 5],
  'gpt-6.2-sol': [2, 10],
  // DeepSeek belgesi (23 Kas 2026): yoğun saat fiyatı; yoğun olmayan saatte yarısı, önbellek isabeti çok daha ucuz. Tahmin üst sınırdır.
  'deepseek-flash': [0.3, 1.2],
};

export const HINTS: Record<string, string> = {
  auth: 'anahtar geçersiz ya da hesapta bakiye yok: anahtarı ve kredi bakiyesini kontrol edin',
  invalid_request: 'istek reddedildi: model adı yanlış ya da bu hesapta kapalı olabilir',
  rate_limit: 'kota doldu: biraz bekleyip yeniden deneyin',
  timeout: 'cevap süresinde gelmedi: yavaş model olabilir, süreyi uzatın (--timeout 120)',
  server_error: 'servis geçici olarak yanıt vermiyor ya da bağlantı kurulamadı',
  safety_blocked: 'güvenlik filtresi cevabı engelledi',
  empty_output: 'boş cevap geldi',
  invalid_output: 'cevap beklenen biçimde değil (JSON bozuk ya da token sınırında kesildi)',
};

export const redact = (text: string, secret: string): string =>
  secret ? text.split(secret).join('***') : text;

/** Komut satırındaki `--ad değer` çiftinin değeri. */
export function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `--timeout <saniye>` değeri milisaniye olarak; geçersiz ya da yoksa varsayılan. */
export function timeoutMs(defaultSeconds: number): number {
  const seconds = Number(option('--timeout') ?? defaultSeconds);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : defaultSeconds) * 1000;
}

/** Kökteki .env'yi süreç ortamına yükler (ekrana yazmaz). DATABASE_URL eksikliği burada önemsiz. */
export function loadSmokeEnv(): void {
  try {
    loadEnv();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
  }
}

/**
 * Anahtarı tanımlı sağlayıcılar için deneme hedefleri. Tek deneme: yeniden deneme kapalı, sorun neyse
 * olduğu gibi görünsün; her istek `timeout` ms içinde bitmek zorunda.
 */
export function providerTargets(
  models: { claude: string; gemini: string; openai: string; deepseek: string },
  timeout: number,
): SmokeTarget[] {
  const safe = (p: LLMProvider) => withResilience(p, { maxAttempts: 1, timeoutMs: timeout });
  const key = (name: string) => process.env[name]?.trim() ?? '';
  const targets: SmokeTarget[] = [];

  const add = (
    label: string,
    secret: string,
    model: string,
    make: (apiKey: string) => LLMProvider,
  ) => {
    if (!secret) return;
    const price = PRICES[model];
    targets.push({
      label,
      provider: safe(make(secret)),
      model,
      secret,
      ...(price && { price }),
    });
  };
  add(
    'Claude',
    key('ANTHROPIC_API_KEY'),
    models.claude,
    (apiKey) => new AnthropicProvider({ apiKey }),
  );
  add('Gemini', key('GEMINI_API_KEY'), models.gemini, (apiKey) => new GoogleProvider({ apiKey }));
  add('OpenAI', key('OPENAI_API_KEY'), models.openai, (apiKey) => new OpenAIProvider({ apiKey }));
  add(
    'DeepSeek',
    key('DEEPSEEK_API_KEY'),
    models.deepseek,
    (apiKey) => new DeepSeekProvider({ apiKey }),
  );
  return targets;
}
