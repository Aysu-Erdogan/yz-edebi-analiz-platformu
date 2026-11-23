import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promptTemplateInputSchema } from '../src/domain/prompt.js';
import { rubricInputSchema, type RubricInput } from '../src/domain/rubric.js';
import { isRetryableKind } from '../src/providers/provider.js';
import { judgeText } from '../src/services/judge.service.js';
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
 * `npm run judge:smoke`: her hakem modele GERÇEK bir puanlama isteği atar (iki kısa örnek metin, taslak
 * şiir rubriği, `judge-v1` komutu). Veritabanına yazmaz, rubriği "kullanıldı" yapmaz. Amaç bilimsel sonuç
 * değil, bir duman testi: sağlayıcı hakem JSON şemasını kabul ediyor mu, cevap geçerli mi, süre ve maliyet ne.
 * API anahtarlarını ASLA yazmaz.
 */

export type JudgeSmokeTarget = SmokeTarget;

export interface JudgeSmokeSample {
  name: string;
  text: string;
}

export interface JudgeSmokeContext {
  template: { version: string; body: string };
  rubric: RubricInput;
  theme: string;
}

/**
 * Sağlık kontrolü örnekleri: biri makul bir şiir, ikincisi bilerek zayıf ve klişe. Hakemin ikisini ayırt edip
 * edemediğine bakılır. Örnekler bu denemeye özeldir (benim yazdığım metinler), araştırma verisi değildir.
 */
export const SMOKE_SAMPLES: JudgeSmokeSample[] = [
  {
    name: 'güçlü',
    text: [
      'Yaprak yaprak döküldü gün,',
      'rüzgâr eski bir türkü tuttu;',
      'bahçenin ucunda unutulmuş bir sandalye',
      'yazdan kalan ışığı bekler hâlâ.',
      '',
      'Akşam, çatıların ardında',
      'bakır bir sessizlik eritir kendini;',
      'ben, kapıda, adını anmadığım bir yılı',
      'cebimde ısınan bir anahtar gibi tutarım.',
    ].join('\n'),
  },
  {
    name: 'zayıf',
    text: [
      'Sonbahar geldi yapraklar sarardı',
      'Gönlüm çok üzgün hep ağladı',
      'Hava soğudu ben de üşüdüm',
      'Sonbahar güzel sonbahar güzel',
      'Yağmur yağdı ıslandım',
      'Sonbahar sonbahar sonbahar',
    ].join('\n'),
  },
];

const seed = (path: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../prisma/seed-data/${path}`, import.meta.url)), 'utf8'),
  );

/** Gerçek taslak şiir rubriği ve `judge-v1` komutu (seed dosyalarından). */
export function loadJudgeSmokeContext(): JudgeSmokeContext {
  const template = promptTemplateInputSchema.parse(seed('prompts/judge-v1.json'));
  return {
    template,
    rubric: rubricInputSchema.parse(seed('rubrics/v0.1-taslak/siir.json')),
    theme: 'Sonbahar',
  };
}

/** Her hedefi her örnekle dener, sonuçları `log` ile yazar; hepsi başarılıysa true döner. */
export async function judgeSmoke(
  targets: JudgeSmokeTarget[],
  samples: JudgeSmokeSample[],
  context: JudgeSmokeContext,
  log: (line: string) => void,
): Promise<boolean> {
  if (targets.length === 0) {
    log(
      'Denenecek hakem yok: .env içinde Claude, Gemini, OpenAI ya da DeepSeek API anahtarı (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY) tanımlı değil.',
    );
    return false;
  }

  let ok = true;
  let totalCost = 0;
  for (const target of targets) {
    const { label, provider, model, secret, price } = target;
    const totals: (number | undefined)[] = [];

    for (const sample of samples) {
      const name = `${label.padEnd(7)} ${model} [${sample.name}]`;
      try {
        const outcome = await judgeText(provider, {
          template: context.template,
          rubric: context.rubric,
          genre: context.rubric.genre,
          theme: context.theme,
          text: sample.text,
          model,
        });
        if (outcome.status === 'succeeded') {
          totals.push(outcome.total);
          const cost = price
            ? (outcome.inputTokens * price[0] + outcome.outputTokens * price[1]) / 1e6
            : undefined;
          totalCost += cost ?? 0;
          log(
            `✔ ${name}: ${(outcome.latencyMs / 1000).toFixed(1)} sn, ${outcome.inputTokens} giriş + ${outcome.outputTokens} çıkış token` +
              (cost === undefined ? '' : `, ≈ $${cost.toFixed(5)}`) +
              `, ${outcome.attempts} deneme, toplam ${outcome.total.toFixed(1)}`,
          );
          log(`    puanlar: ${outcome.scores.map((s) => `${s.key} ${s.score}`).join(', ')}`);
        } else {
          ok = false;
          totals.push(undefined);
          log(
            `✖ ${name}: ${outcome.kind} (${isRetryableKind(outcome.kind) ? 'geçici' : 'kalıcı'}), ${outcome.attempts} deneme`,
          );
          log(`    ileti: ${redact(outcome.error, secret).slice(0, 300)}`);
          log(`    ipucu: ${HINTS[outcome.kind] ?? 'bu çıktıyı bana iletin'}`);
        }
      } catch (error) {
        ok = false;
        totals.push(undefined);
        const message = error instanceof Error ? error.message : String(error);
        log(`✖ ${name}: beklenmeyen hata`);
        log(`    ileti: ${redact(message, secret).slice(0, 300)}`);
        log('    ipucu: bu çıktıyı bana iletin');
      }
    }

    // Sağlık kontrolü: ilk örnek güçlü, ikincisi zayıf olarak hazırlandı.
    const [strong, weak] = totals;
    if (strong !== undefined && weak !== undefined) {
      log(
        strong > weak
          ? `  → ${label} güçlü ve zayıf örneği ayırt etti (${strong.toFixed(1)} > ${weak.toFixed(1)})`
          : `  ⚠ ${label} güçlü ve zayıf örneği ayırt edemedi (${strong.toFixed(1)} ve ${weak.toFixed(1)})`,
      );
    }
  }
  log(`Toplam yaklaşık maliyet: $${totalCost.toFixed(5)}`);
  return ok;
}

async function main(): Promise<void> {
  loadSmokeEnv();
  // Varsayılan: karşılaştırmada kullanılacak orta sınıf hakem adayları (ADR 0010). Süre varsayılan 300 sn:
  // Gemini 4 Hydrogen bir kelimelik JSON'da 83,6 sn sürmüştü.
  const targets = providerTargets(
    {
      claude: option('--claude') ?? 'claude-sonnet-5-5',
      gemini: option('--gemini') ?? 'gemini-4-hydrogen',
      openai: option('--openai') ?? 'gpt-6.2-sol',
      deepseek: option('--deepseek') ?? 'deepseek-flash',
    },
    timeoutMs(300),
  );

  console.log(
    'Gerçek hakem denemesi (ücretli, birkaç sent): her hakeme 2 örnek metin puanlatılıyor. Anahtarlar yazdırılmaz.',
  );
  const ok = await judgeSmoke(targets, SMOKE_SAMPLES, loadJudgeSmokeContext(), console.log);
  process.exitCode = ok ? 0 : 1;
}

// Yalnızca doğrudan çalıştırılınca; test dosyaları içe aktarırken çalışmaz.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
