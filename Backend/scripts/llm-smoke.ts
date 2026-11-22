import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { EnvError, loadEnv } from '../src/config/env.js';
import { AnthropicProvider } from '../src/providers/anthropic-provider.js';
import { GoogleProvider } from '../src/providers/google-provider.js';
import { OpenAIProvider } from '../src/providers/openai-provider.js';
import { ProviderError, type LLMProvider } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';

/**
 * `npm run llm:smoke`: her sağlayıcıya iki küçük GERÇEK istek atar (düz metin ve JSON cevap).
 * Maliyet kuruşlar düzeyindedir. API anahtarlarını ASLA yazmaz.
 */

export interface SmokeTarget {
  label: string;
  provider: LLMProvider;
  model: string;
  /** Çıktıya sızmasın diye hata iletilerinden silinir. */
  secret: string;
  /** Milyon token başına [girdi, çıktı] dolar; bilinmiyorsa maliyet yazılmaz. */
  price?: [number, number];
}

const HINTS: Record<string, string> = {
  auth: 'anahtar geçersiz ya da hesapta bakiye yok: anahtarı ve kredi bakiyesini kontrol edin',
  invalid_request: 'istek reddedildi: model adı yanlış ya da bu hesapta kapalı olabilir',
  rate_limit: 'kota doldu: biraz bekleyip yeniden deneyin',
  timeout:
    'cevap süresinde gelmedi: yavaş model olabilir, süreyi uzatın (npm run llm:smoke -- --timeout 120)',
  server_error: 'servis geçici olarak yanıt vermiyor ya da bağlantı kurulamadı',
  safety_blocked: 'güvenlik filtresi cevabı engelledi',
  empty_output: 'boş cevap geldi',
  invalid_output: 'cevap beklenen biçimde değil (JSON bozuk ya da token sınırında kesildi)',
};

const redact = (text: string, secret: string): string =>
  secret ? text.split(secret).join('***') : text;

/** Metin için bir kelimelik, JSON için tek alanlı küçük istekler: en ucuz modelde bile kuruşlar. */
const TEXT_PROMPT = 'Tek bir Türkçe kelime yaz: selam';
const JSON_PROMPT = 'Yalnızca şu biçimde JSON ile cevap ver: {"cevap": "selam"}';
const MAX_TOKENS = 1024; // düşünen modellerde düşünme tokenleri de sınıra dahildir

/** Hedeflerin hepsini dener, sonuçları `log` ile yazar; hepsi başarılıysa true döner. */
export async function smoke(targets: SmokeTarget[], log: (line: string) => void): Promise<boolean> {
  if (targets.length === 0) {
    log(
      'Denenecek sağlayıcı yok: .env içinde Claude, Gemini ya da OpenAI API anahtarı (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY) tanımlı değil.',
    );
    return false;
  }

  let ok = true;
  let totalCost = 0;
  for (const target of targets) {
    const { label, provider, model, secret, price } = target;
    const checks = [
      ['metin', () => provider.generateText({ model, prompt: TEXT_PROMPT, maxTokens: MAX_TOKENS })],
      [
        'json ',
        async () => {
          const r = await provider.generateJson({
            model,
            prompt: JSON_PROMPT,
            maxTokens: MAX_TOKENS,
            schema: z.object({ cevap: z.string() }),
          });
          return { ...r, text: JSON.stringify(r.data) };
        },
      ],
    ] as const;

    for (const [kind, run] of checks) {
      const name = `${label.padEnd(7)} ${kind}`;
      try {
        const r = await run();
        const cost = price
          ? (r.inputTokens * price[0] + r.outputTokens * price[1]) / 1e6
          : undefined;
        totalCost += cost ?? 0;
        log(
          `✔ ${name} ${model}: ${(r.latencyMs / 1000).toFixed(1)} sn, ${r.inputTokens} giriş + ${r.outputTokens} çıkış token` +
            (cost === undefined ? '' : `, ≈ $${cost.toFixed(5)}`) +
            ` → ${JSON.stringify(r.text.slice(0, 60))}`,
        );
      } catch (error) {
        ok = false;
        const known = error instanceof ProviderError ? error : undefined;
        const message = error instanceof Error ? error.message : String(error);
        log(
          `✖ ${name} ${model}: ${known?.kind ?? 'beklenmeyen hata'} (${known ? (known.retryable ? 'geçici' : 'kalıcı') : '?'})`,
        );
        log(`    ileti: ${redact(message, secret).slice(0, 300)}`);
        log(`    ipucu: ${(known && HINTS[known.kind]) ?? 'bu çıktıyı bana iletin'}`);
      }
    }
  }
  log(`Toplam yaklaşık maliyet: $${totalCost.toFixed(5)}`);
  return ok;
}

/** Komut satırındaki `--claude <model>`, `--gemini <model>` ve `--openai <model>` değerleri. */
function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  try {
    loadEnv(); // kökteki .env'yi yükler (süreç ortamına, ekrana değil)
  } catch (error) {
    if (!(error instanceof EnvError)) throw error; // DATABASE_URL eksikliği burada önemsiz
  }

  const claudeKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
  const claudeModel = option('--claude') ?? 'claude-haiku-5-5';
  const geminiModel = option('--gemini') ?? 'gemini-3.5-flash-lite';
  const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  const openaiModel = option('--openai') ?? 'gpt-6-luna';

  // Tek deneme: deneme komutunda yeniden deneme yok, sorun neyse olduğu gibi görünsün.
  // Süre varsayılan 30 sn; yavaş modeller için `--timeout <saniye>` ile uzatılır.
  const seconds = Number(option('--timeout') ?? 30);
  const timeoutMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000;
  const safe = (p: LLMProvider) => withResilience(p, { maxAttempts: 1, timeoutMs });
  const targets: SmokeTarget[] = [];
  if (claudeKey) {
    targets.push({
      label: 'Claude',
      provider: safe(new AnthropicProvider({ apiKey: claudeKey })),
      model: claudeModel,
      secret: claudeKey,
      price: {
        'claude-haiku-5-5': [0.1, 0.5],
        'claude-sonnet-5-5': [2, 10],
        'claude-opus-5-5': [4, 20],
      }[claudeModel] as [number, number] | undefined,
    });
  }
  if (geminiKey) {
    targets.push({
      label: 'Gemini',
      provider: safe(new GoogleProvider({ apiKey: geminiKey })),
      model: geminiModel,
      secret: geminiKey,
      // gemini-3.8-flash ve 3.6-flash: 31 Aralık 2026'ya kadar bu fiyat, 1 Ocak 2027'den sonra [1.5, 7.5] (ADR 0010).
      price: {
        'gemini-3.5-flash-lite': [0.3, 2.5],
        'gemini-3.6-flash': [0.75, 3.75],
        'gemini-3.8-flash': [0.75, 3.75],
        'gemini-4-hydrogen': [1.5, 7.5], // zam tarihi belgede yok (22 Kas 2026)
      }[geminiModel] as [number, number] | undefined,
    });
  }
  if (openaiKey) {
    targets.push({
      label: 'OpenAI',
      provider: safe(new OpenAIProvider({ apiKey: openaiKey })),
      model: openaiModel,
      secret: openaiKey,
      price: {
        'gpt-6-luna': [0.1, 0.5],
        'gpt-6.1-terra': [1, 5],
        'gpt-6.2-sol': [2, 10],
      }[openaiModel] as [number, number] | undefined,
    });
  }

  console.log('Gerçek servislere küçük istekler atılıyor (kuruşluk). Anahtarlar yazdırılmaz.');
  const ok = await smoke(targets, console.log);
  process.exitCode = ok ? 0 : 1;
}

// Yalnızca doğrudan çalıştırılınca; test dosyaları içe aktarırken çalışmaz.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
