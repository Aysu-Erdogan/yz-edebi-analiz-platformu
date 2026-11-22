import { describe, expect, it } from 'vitest';
import {
  SMOKE_SAMPLES,
  judgeSmoke,
  loadJudgeSmokeContext,
  type JudgeSmokeTarget,
} from '../scripts/judge-smoke.js';
import { PRICES, providerTargets } from '../scripts/smoke-common.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import {
  ProviderError,
  type GenerateRequest,
  type JsonRequest,
  type LLMProvider,
} from '../src/providers/provider.js';

const context = loadJudgeSmokeContext();

const answerFor = (puan: number) =>
  JSON.stringify({
    puanlar: Object.fromEntries(
      context.rubric.criteria.map((c) => [c.key, { puan, gerekce: 'gerekçe' }]),
    ),
  });

/** Güçlü örneği yüksek, zayıf örneği düşük puanlayan hakem. */
const discerning = (req: GenerateRequest) =>
  answerFor(req.prompt.includes(SMOKE_SAMPLES[0]!.text.slice(0, 30)) ? 5 : 1);

const target = (over: Partial<JudgeSmokeTarget> & Pick<JudgeSmokeTarget, 'provider'>) => ({
  label: 'Claude',
  model: 'claude-sonnet-5-5',
  secret: 'sk-GIZLI-ANAHTAR',
  price: [2, 10] as [number, number],
  ...over,
});

async function run(targets: JudgeSmokeTarget[]) {
  const lines: string[] = [];
  const ok = await judgeSmoke(targets, SMOKE_SAMPLES, context, (line) => lines.push(line));
  return { ok, output: lines.join('\n') };
}

describe('judge:smoke (gerçek hakem denemesi)', () => {
  it('çalışan hakem için her örnekte ✔, puanlar, toplam, süre, token ve maliyet gösterir; anahtarı yazmaz', async () => {
    const { ok, output } = await run([
      target({ provider: new MockProvider({ respond: discerning }) }),
    ]);
    expect(ok).toBe(true);
    expect(output.match(/✔/g)).toHaveLength(SMOKE_SAMPLES.length);
    expect(output).toContain('Claude');
    expect(output).toContain('claude-sonnet-5-5');
    for (const criterion of context.rubric.criteria) expect(output).toContain(criterion.key);
    expect(output).toContain('toplam 100.0'); // güçlü örnek: her kriter 5 → 100
    expect(output).toContain('toplam 0.0'); // zayıf örnek: her kriter 1 → 0
    expect(output).toContain('≈ $');
    expect(output).toContain('sn');
    expect(output).not.toContain('sk-GIZLI-ANAHTAR');
  });

  it('maliyeti sağlayıcının bildirdiği tokenlerden ve fiyat tablosundan hesaplar, toplamı yazar', async () => {
    // 1000 giriş + 500 çıkış token, $2 / $10 (milyon token): (1000·2 + 500·10) / 1e6 = $0,007 çağrı başına
    const provider: LLMProvider = {
      id: 'mock',
      generateText: () => Promise.reject(new Error('kullanılmaz')),
      generateJson: <T>(req: JsonRequest<T>) =>
        Promise.resolve({
          data: req.schema.parse(JSON.parse(answerFor(3))),
          inputTokens: 1000,
          outputTokens: 500,
          latencyMs: 2500,
        }),
    };
    const { output } = await run([target({ provider })]);
    expect(output.match(/≈ \$0\.00700/g)).toHaveLength(2);
    expect(output).toContain('Toplam yaklaşık maliyet: $0.01400');
  });

  it('güçlü örneği zayıftan yüksek puanlayan hakemi "ayırt etti" diye işaretler', async () => {
    const { output } = await run([target({ provider: new MockProvider({ respond: discerning }) })]);
    expect(output).toContain('ayırt etti');
    expect(output).not.toContain('ayırt edemedi');
  });

  it('iki örneğe aynı puanı veren ya da ters veren hakemi uyarır, ama çağrılar başarılı olduğu için hata saymaz', async () => {
    for (const respond of [
      () => answerFor(3),
      (req: GenerateRequest) =>
        answerFor(req.prompt.includes(SMOKE_SAMPLES[0]!.text.slice(0, 30)) ? 1 : 5),
    ]) {
      const { ok, output } = await run([target({ provider: new MockProvider({ respond }) })]);
      expect(ok).toBe(true);
      expect(output).toContain('ayırt edemedi');
    }
  });

  it('bozuk cevap bir kez yeniden denenir: ikincisi geçerliyse ✔ ve 2 deneme yazar', async () => {
    let n = 0;
    const provider = new MockProvider({
      respond: (req) => (n++ === 0 ? '{"puanlar": {' : discerning(req)),
    });
    const { ok, output } = await run([target({ provider })]);
    expect(ok).toBe(true);
    expect(output).toContain('2 deneme');
  });

  it('iki cevap da bozuksa ✖, hata türü ve ipucu gösterir; puan yazmaz', async () => {
    const { ok, output } = await run([
      target({ provider: new MockProvider({ respond: () => 'bozuk' }) }),
    ]);
    expect(ok).toBe(false);
    expect(output).toContain('✖');
    expect(output).toContain('invalid_output');
    expect(output).toContain('2 deneme');
    expect(output).not.toContain('toplam');
    expect(output).not.toContain('ayırt');
  });

  it('sağlayıcı hatasında ✖, tür ve ipucu gösterir; iletideki anahtarı gizler', async () => {
    const provider = new MockProvider({
      respond: () => {
        throw new ProviderError('auth', 'HTTP 401: anahtar sk-GIZLI-ANAHTAR geçersiz');
      },
    });
    const { ok, output } = await run([target({ provider, label: 'OpenAI', model: 'gpt-6.2-sol' })]);
    expect(ok).toBe(false);
    expect(output).toContain('✖');
    expect(output).toContain('auth');
    expect(output).toContain('bakiye'); // ipucu
    expect(output).toContain('***');
    expect(output).not.toContain('sk-GIZLI-ANAHTAR');
  });

  it('biri başarısız olunca genel sonuç başarısız, diğeri ✔ kalır; fiyatı bilinmeyen modelde maliyet yazılmaz', async () => {
    const { ok, output } = await run([
      target({
        provider: new MockProvider({ respond: discerning }),
        model: 'yeni-model',
        price: undefined,
      }),
      target({
        label: 'Gemini',
        model: 'gemini-x',
        provider: new MockProvider({
          respond: () => {
            throw new ProviderError('timeout', 'süre doldu');
          },
        }),
      }),
    ]);
    expect(ok).toBe(false);
    expect(output.match(/✔/g)).toHaveLength(SMOKE_SAMPLES.length);
    expect(output).toContain('geçici');
    // Maliyet yalnızca fiyatı bilinen modelin satırında olabilir: başarılı satırlarda yok.
    const successLines = output.split('\n').filter((l) => l.startsWith('✔'));
    for (const line of successLines) expect(line).not.toContain('≈ $');
  });

  it('hakem komutuna örnek metni yalnızca metin olarak koyar; çağrıda yazar modeli diye bir bilgi yoktur', async () => {
    const provider = new MockProvider({ respond: discerning });
    await run([target({ provider })]);
    expect(provider.calls).toHaveLength(SMOKE_SAMPLES.length);
    for (const call of provider.calls) {
      expect(call.prompt).toContain('<metin>');
      expect(call.model).toBe('claude-sonnet-5-5');
    }
  });

  it('hiç hakem yoksa (anahtar tanımsız) başarısız döner ve anahtar uyarısı verir', async () => {
    const { ok, output } = await run([]);
    expect(ok).toBe(false);
    expect(output).toContain('anahtar');
  });

  it('örnekler: biri güçlü biri zayıf, ikisi de dolu ve farklı', () => {
    expect(SMOKE_SAMPLES).toHaveLength(2);
    expect(SMOKE_SAMPLES[0]!.text.trim().length).toBeGreaterThan(0);
    expect(SMOKE_SAMPLES[1]!.text.trim().length).toBeGreaterThan(0);
    expect(SMOKE_SAMPLES[0]!.text).not.toBe(SMOKE_SAMPLES[1]!.text);
  });

  it('gerçek taslak rubrik ve yargıç şablonu yüklenir, hakem modelleri için fiyat tablosunda yer alır', () => {
    expect(context.rubric.genre).toBe('siir');
    expect(context.rubric.criteria).toHaveLength(5);
    expect(context.template.body).toContain('{{metin}}');
    // Fiyatlar ADR 0010 ve rapor belgesi bölüm 5 ile aynı olmalı (milyon token başına $ girdi / çıktı).
    expect(PRICES['claude-sonnet-5-5']).toEqual([2, 10]);
    expect(PRICES['gemini-4-hydrogen']).toEqual([1.5, 7.5]);
    expect(PRICES['gpt-6.2-sol']).toEqual([2, 10]);
  });

  it('providerTargets: yalnızca anahtarı tanımlı sağlayıcıları kurar, fiyatı tablodan alır, bilinmeyen modele fiyat koymaz', () => {
    const names = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'] as const;
    const saved = names.map((n) => process.env[n]);
    try {
      process.env.ANTHROPIC_API_KEY = 'claude-anahtar';
      process.env.GEMINI_API_KEY = '';
      process.env.OPENAI_API_KEY = '  gpt-anahtar  ';
      const targets = providerTargets(
        { claude: 'claude-sonnet-5-5', gemini: 'gemini-4-hydrogen', openai: 'yeni-model' },
        1000,
      );
      expect(targets.map((t) => t.label)).toEqual(['Claude', 'OpenAI']); // Gemini anahtarı boş
      expect(targets[0]).toMatchObject({ model: 'claude-sonnet-5-5', price: [2, 10] });
      expect(targets[0]?.secret).toBe('claude-anahtar');
      expect(targets[1]?.secret).toBe('gpt-anahtar'); // boşluklar kırpılır
      expect(targets[1]).not.toHaveProperty('price');
    } finally {
      names.forEach((n, i) => {
        if (saved[i] === undefined) delete process.env[n];
        else process.env[n] = saved[i];
      });
    }
  });
});
