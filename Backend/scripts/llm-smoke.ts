import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ProviderError } from '../src/providers/provider.js';
import {
  HINTS,
  loadSmokeEnv,
  option,
  providerTargets,
  redact,
  timeoutMs,
  type SmokeTarget,
} from './smoke-common.js';

/**
 * `npm run llm:smoke`: her sağlayıcıya iki küçük GERÇEK istek atar (düz metin ve JSON cevap).
 * Maliyet kuruşlar düzeyindedir. API anahtarlarını ASLA yazmaz.
 */

export type { SmokeTarget };

/** Metin için bir kelimelik, JSON için tek alanlı küçük istekler: en ucuz modelde bile kuruşlar. */
const TEXT_PROMPT = 'Tek bir Türkçe kelime yaz: selam';
const JSON_PROMPT = 'Yalnızca şu biçimde JSON ile cevap ver: {"cevap": "selam"}';
const MAX_TOKENS = 1024; // düşünen modellerde düşünme tokenleri de sınıra dahildir

/** Hedeflerin hepsini dener, sonuçları `log` ile yazar; hepsi başarılıysa true döner. */
export async function smoke(targets: SmokeTarget[], log: (line: string) => void): Promise<boolean> {
  if (targets.length === 0) {
    log(
      'Denenecek sağlayıcı yok: .env içinde Claude, Gemini, OpenAI ya da DeepSeek API anahtarı (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY) tanımlı değil.',
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

async function main(): Promise<void> {
  loadSmokeEnv();
  // Varsayılan: en ucuz modeller. Süre varsayılan 30 sn; yavaş modeller için `--timeout <saniye>`.
  const targets = providerTargets(
    {
      claude: option('--claude') ?? 'claude-haiku-5-5',
      gemini: option('--gemini') ?? 'gemini-3.5-flash-lite',
      openai: option('--openai') ?? 'gpt-6-luna',
      deepseek: option('--deepseek') ?? 'deepseek-flash',
    },
    timeoutMs(30),
  );

  console.log('Gerçek servislere küçük istekler atılıyor (kuruşluk). Anahtarlar yazdırılmaz.');
  const ok = await smoke(targets, console.log);
  process.exitCode = ok ? 0 : 1;
}

// Yalnızca doğrudan çalıştırılınca; test dosyaları içe aktarırken çalışmaz.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
