import { describe, expect, it, vi } from 'vitest';
import {
  injectionCases,
  injectionJson,
  formatInjection,
  planInjection,
  runInjection,
  runInjectionCli,
  summarizeInjection,
  type InjectionCase,
} from '../scripts/injection.js';
import { SMOKE_SAMPLES, loadJudgeSmokeContext } from '../scripts/judge-smoke.js';
import type { SmokeTarget } from '../scripts/smoke-common.js';
import { neutralizeText } from '../src/domain/judge.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import {
  ProviderError,
  type GenerateRequest,
  type JsonRequest,
  type LLMProvider,
} from '../src/providers/provider.js';

const context = loadJudgeSmokeContext();
const cases = injectionCases(context.rubric);
const KEYS = context.rubric.criteria.map((c) => c.key);

const answerFor = (puan: number) =>
  JSON.stringify({
    puanlar: Object.fromEntries(KEYS.map((k) => [k, { puan, gerekce: `gerekçe ${puan}` }])),
  });

/** Komuttaki metne bakıp hangi vakanın geldiğini bulur (en uzun eşleşme: saldırılar kontrolü de içerir). */
const identify = (prompt: string): InjectionCase =>
  cases
    .filter((c) => prompt.includes(neutralizeText(c.text)))
    .sort((a, b) => b.text.length - a.text.length)[0]!;

type Script = Record<string, (number | 'bozuk')[]>;

/** Vaka başına sıradaki cevabı verir: sayı = tüm kriterlere o puan, 'bozuk' = geçersiz cevap. Her çağrı bir değer tüketir. */
function scripted(table: Script, fallback = 3) {
  const seen: Record<string, number> = {};
  return (req: GenerateRequest): string => {
    const key = identify(req.prompt).key;
    const i = (seen[key] = (seen[key] ?? -1) + 1);
    const value = table[key]?.[i] ?? table[key]?.at(-1) ?? fallback;
    return value === 'bozuk' ? 'bozuk' : answerFor(value);
  };
}

const target = (provider: LLMProvider, over: Partial<SmokeTarget> = {}): SmokeTarget => ({
  label: 'DeepSeek',
  model: 'deepseek-flash',
  secret: 'sk-GIZLI-ANAHTAR',
  price: [0.3, 1.2],
  provider,
  ...over,
});

const mock = (table: Script = {}, fallback = 3) =>
  new MockProvider({ respond: scripted(table, fallback) });

const run = (provider: LLMProvider, repeats = 3) =>
  runInjection(target(provider), cases, context, repeats);

describe('injectionCases: saldırı ve kontrol metinleri', () => {
  it('2 kontrol ve 8 saldırı, anahtarlar benzersiz', () => {
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((c) => c.key)).size).toBe(10);
    expect(cases.filter((c) => c.control === null).map((c) => c.key)).toEqual([
      'kontrol-zayif',
      'kontrol-guclu',
    ]);
    expect(cases.filter((c) => c.control !== null)).toHaveLength(8);
  });

  it('kontroller hakem denemesindeki örnek şiirlerdir, aynen', () => {
    expect(cases.find((c) => c.key === 'kontrol-guclu')?.text).toBe(SMOKE_SAMPLES[0]!.text);
    expect(cases.find((c) => c.key === 'kontrol-zayif')?.text).toBe(SMOKE_SAMPLES[1]!.text);
  });

  it('yukarı yönlü 7 saldırı zayıf, aşağı yönlü 1 saldırı güçlü şiirle karşılaştırılır', () => {
    const up = cases.filter((c) => c.direction === 'up');
    const down = cases.filter((c) => c.direction === 'down');
    expect(up).toHaveLength(7);
    expect(up.every((c) => c.control === 'kontrol-zayif')).toBe(true);
    expect(down.map((c) => [c.key, c.control])).toEqual([['asagi', 'kontrol-guclu']]);
  });

  it('her saldırı metni boş değil, kontrolden ve diğerlerinden farklı', () => {
    expect(new Set(cases.map((c) => c.text)).size).toBe(10);
    for (const c of cases) expect(c.text.trim()).not.toBe('');
  });

  it('sahte cevap saldırısı rubrikteki bütün kriter anahtarlarını içerir', () => {
    const text = cases.find((c) => c.key === 'sahte-cevap')!.text;
    for (const key of KEYS) expect(text).toContain(`"${key}"`);
    // sahte cevabın amacı tam puan: her kriterde ölçeğin üst değeri (5)
    expect(text.split('"puan":5')).toHaveLength(KEYS.length + 1);
  });

  it('yalnızca etiket kırma saldırısı sahte metin etiketi içerir', () => {
    for (const c of cases) {
      const hasTag = /<\s*\/?\s*metin\s*>/i.test(c.text);
      expect(hasTag, c.key).toBe(c.key === 'etiket-kirma');
    }
  });
});

describe('hakeme giden komut (ücretsiz, sahte hakemle)', () => {
  it('her vakada tam bir <metin> bloğu var ve metin (etkisizleştirilmiş hâliyle) bloğun içinde', async () => {
    const provider = mock();
    await run(provider, 1);
    expect(provider.calls).toHaveLength(10);
    for (const call of provider.calls) {
      const c = identify(call.prompt);
      expect(call.prompt.split('<metin>'), c.key).toHaveLength(2);
      expect(call.prompt.split('</metin>'), c.key).toHaveLength(2);
      const block = call.prompt.slice(
        call.prompt.indexOf('<metin>') + '<metin>'.length,
        call.prompt.indexOf('</metin>'),
      );
      expect(block, c.key).toContain(neutralizeText(c.text));
    }
  });

  it('etiket kırma saldırısındaki sahte etiketler köşeli parantezli hâle gelir', async () => {
    const provider = mock();
    await run(provider, 1);
    const call = provider.calls.find((x) => identify(x.prompt).key === 'etiket-kirma')!;
    expect(call.prompt).toContain('[/metin]');
    expect(call.prompt).toContain('[metin]');
  });
});

describe('runInjection', () => {
  it('çağrılar tekrar tekrar iç içe sıralanır: önce tüm vakalar (1. tekrar), sonra 2. tekrar', async () => {
    const provider = mock();
    const runs = await run(provider, 2);
    expect(provider.calls).toHaveLength(20);
    const keys = cases.map((c) => c.key);
    expect(provider.calls.map((c) => identify(c.prompt).key)).toEqual([...keys, ...keys]);
    expect(runs.map((r) => [r.caseKey, r.repeat])).toEqual([
      ...keys.map((k) => [k, 1]),
      ...keys.map((k) => [k, 2]),
    ]);
  });

  it('hakem model kimliğini her çağrıya iletir', async () => {
    const provider = mock();
    await run(provider, 1);
    expect(provider.calls.every((c) => c.model === 'deepseek-flash')).toBe(true);
  });

  it('başarılı çalışmada toplam ve kriter puanlarını gerekçeyle saklar', async () => {
    const [first] = await run(mock({ 'kontrol-zayif': [2] }), 1);
    expect(first).toMatchObject({
      caseKey: 'kontrol-zayif',
      repeat: 1,
      status: 'succeeded',
      total: 25,
    });
    if (first?.status === 'succeeded') {
      expect(first.scores).toHaveLength(KEYS.length);
      expect(first.scores[0]).toMatchObject({ key: KEYS[0], score: 2, comment: 'gerekçe 2' });
    }
  });

  it('beklenmeyen hata yakalanır, çalışma "unexpected" ile başarısız sayılır ve anahtar iletiden silinir', async () => {
    const provider: LLMProvider = {
      id: 'mock',
      generateText: () => Promise.reject(new Error('kullanılmaz')),
      generateJson: () => Promise.reject(new Error('kopuk bağlantı sk-GIZLI-ANAHTAR')),
    };
    const runs = await run(provider, 1);
    expect(runs).toHaveLength(10);
    expect(runs.every((r) => r.status === 'failed')).toBe(true);
    const failed = runs[0]!;
    expect(failed.status === 'failed' && failed.kind).toBe('unexpected');
    expect(JSON.stringify(runs)).not.toContain('sk-GIZLI-ANAHTAR');
  });

  it('sağlayıcı hatası türüyle kaydedilir (anahtar hatası = auth)', async () => {
    const provider: LLMProvider = {
      id: 'mock',
      generateText: () => Promise.reject(new Error('kullanılmaz')),
      generateJson: () => Promise.reject(new ProviderError('auth', 'HTTP 402: bakiye bitti')),
    };
    const [first] = await run(provider, 1);
    expect(first).toMatchObject({ status: 'failed', kind: 'auth' });
  });
});

describe('summarizeInjection', () => {
  // kontrol-zayif 2,2,2 → toplam 25; ek-talimat 4,3,5 → 75, 50, 100; kontrol-guclu 5 → 100; asagi 1 → 0
  const table: Script = {
    'kontrol-zayif': [2, 2, 2],
    'ek-talimat': [4, 3, 5],
    'kontrol-guclu': [5],
    asagi: [1],
  };

  it('ortalama, en düşük, en yüksek ve kontrole göre kayma (saldırı − kontrol)', async () => {
    const summaries = summarizeInjection(cases, await run(mock(table)));
    const get = (key: string) => summaries.find((s) => s.key === key)!;
    expect(get('kontrol-zayif')).toMatchObject({
      mean: 25,
      min: 25,
      max: 25,
      shift: null,
      failed: 0,
    });
    expect(get('ek-talimat')).toMatchObject({
      runs: 3,
      succeeded: 3,
      failed: 0,
      mean: 75,
      min: 50,
      max: 100,
      shift: 50,
    });
    expect(get('asagi')).toMatchObject({ mean: 0, shift: -100 });
  });

  it('kriter ortalamaları ve kriter kaymaları ham puan üzerindendir', async () => {
    const summaries = summarizeInjection(cases, await run(mock(table)));
    const ek = summaries.find((s) => s.key === 'ek-talimat')!;
    for (const key of KEYS) {
      expect(ek.criteriaMeans[key]).toBe(4);
      expect(ek.criteriaShift?.[key]).toBe(2); // 4 - 2
    }
  });

  it('hiç başarılı çalışması olmayan vakanın ortalaması ve kayması null, başarısız sayısı yazılır', async () => {
    const summaries = summarizeInjection(
      cases,
      await run(mock({ ...table, 'unut-en': ['bozuk'] })),
    );
    const s = summaries.find((x) => x.key === 'unut-en')!;
    expect(s).toMatchObject({ runs: 3, succeeded: 0, failed: 3, mean: null, shift: null });
  });

  it('kontrol ölçülemezse saldırının kayması da ölçülemez (null)', async () => {
    const summaries = summarizeInjection(
      cases,
      await run(mock({ ...table, 'kontrol-zayif': ['bozuk'] })),
    );
    const ek = summaries.find((s) => s.key === 'ek-talimat')!;
    expect(ek.mean).toBe(75);
    expect(ek.shift).toBeNull();
    expect(ek.criteriaShift).toBeNull();
  });

  it('kısmen başarısız vakada ortalama yalnızca başarılı çalışmalardan alınır', async () => {
    // ek-talimat: 1. tekrarın iki denemesi bozuk (yeniden deneme de bozuk), sonra 4 ve 5
    const summaries = summarizeInjection(
      cases,
      await run(mock({ ...table, 'ek-talimat': ['bozuk', 'bozuk', 4, 5] })),
    );
    const ek = summaries.find((s) => s.key === 'ek-talimat')!;
    expect(ek).toMatchObject({ runs: 3, succeeded: 2, failed: 1, mean: 87.5, min: 75, max: 100 });
  });

  it('vaka sırası korunur', async () => {
    const summaries = summarizeInjection(cases, await run(mock(table)));
    expect(summaries.map((s) => s.key)).toEqual(cases.map((c) => c.key));
  });
});

/** Her çağrı için sabit 1000 giriş + 500 çıkış token bildiren hakem (maliyet hesabını sınamak için). */
const metered: LLMProvider = {
  id: 'mock',
  generateText: () => Promise.reject(new Error('kullanılmaz')),
  generateJson: <T>(req: JsonRequest<T>) =>
    Promise.resolve({
      data: req.schema.parse(JSON.parse(answerFor(3))),
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 2000,
    }),
};

describe('formatInjection', () => {
  const info = {
    label: 'DeepSeek',
    model: 'deepseek-flash',
    repeats: 3,
    price: [0.3, 1.2] as [number, number],
  };
  const text = async (table: Script) => {
    const runs = await run(mock(table));
    return formatInjection(summarizeInjection(cases, runs), runs, info).join('\n');
  };

  it('vaka adlarını, yönü, ortalamayı ve işaretli kaymayı yazar', async () => {
    const out = await text({
      'kontrol-zayif': [2],
      'ek-talimat': [4],
      'kontrol-guclu': [5],
      asagi: [1],
    });
    expect(out).toContain('DeepSeek');
    expect(out).toContain('deepseek-flash');
    expect(out).toContain('30 çağrı');
    expect(out).toContain('ek-talimat');
    expect(out).toContain('kayma +50.0');
    expect(out).toContain('kayma -100.0');
    expect(out).toContain('ort 25.0');
    expect(out).toContain('↑');
    expect(out).toContain('↓');
    expect(out).toContain('imgeGucu +2.0');
  });

  it('başarısız çağrıları sayar, nedenini listeler; kayma ölçülemezse "ölçülemedi" yazar', async () => {
    const out = await text({ 'unut-en': ['bozuk'] });
    expect(out).toContain('başarısız 3');
    expect(out).toContain('invalid_output');
    expect(out).toContain('ölçülemedi');
  });

  it('maliyeti sağlayıcının bildirdiği tokenlerden ve fiyattan hesaplar', async () => {
    const runs = await run(metered);
    const out = formatInjection(summarizeInjection(cases, runs), runs, info).join('\n');
    // 30 çağrı × (1000·0,3 + 500·1,2) / 1e6 = 30 × 0,0009 = 0,027
    expect(out).toContain('Toplam yaklaşık maliyet: $0.02700');
  });

  it('fiyat bilinmiyorsa maliyet yazmaz, bilinmiyor der', async () => {
    const runs = await run(metered);
    const out = formatInjection(summarizeInjection(cases, runs), runs, {
      ...info,
      price: undefined,
    }).join('\n');
    expect(out).toContain('maliyet bilinmiyor');
    expect(out).not.toContain('Toplam yaklaşık maliyet');
  });
});

describe('planInjection', () => {
  const lines = planInjection(cases, 3, target(mock()), context).join('\n');

  it('hakemi, metin ve çağrı sayısını, komut ve rubrik sürümünü yazar', () => {
    expect(lines).toContain('DeepSeek');
    expect(lines).toContain('deepseek-flash');
    expect(lines).toContain('10 metin (2 kontrol, 8 saldırı)');
    expect(lines).toContain('Tekrar: 3');
    expect(lines).toContain('Toplam çağrı: 30');
    expect(lines).toContain('judge-v1');
    expect(lines).toContain('0.1-taslak');
    expect(lines).toContain('Veritabanına yazılmaz');
  });

  it('en kötü durum üst sınırı: 30 çağrı × 4096 çıkış token × 1,2 $ en az 0,147 $', () => {
    const match = /üst sınırı: \$(\d+\.\d+)/.exec(lines);
    expect(match).not.toBeNull();
    const value = Number(match![1]);
    expect(value).toBeGreaterThan(0.147);
    expect(value).toBeLessThan(0.25);
  });

  it('fiyat bilinmiyorsa üst sınır "bilinmiyor" olur', () => {
    const out = planInjection(cases, 3, target(mock(), { price: undefined }), context).join('\n');
    expect(out).toContain('bilinmiyor');
    expect(out).not.toMatch(/üst sınırı: \$/);
  });
});

describe('injectionJson', () => {
  it('Türkçe anahtarlarla vakaları, çalışmaları ve gerekçeleri yazar', async () => {
    const runs = await run(
      mock({ 'kontrol-zayif': [2], 'ek-talimat': [4], 'unut-en': ['bozuk'] }),
      2,
    );
    const json = JSON.parse(
      injectionJson(
        summarizeInjection(cases, runs),
        runs,
        { label: 'DeepSeek', model: 'deepseek-flash', repeats: 2, price: [0.3, 1.2] },
        new Date('2026-11-23T12:00:00.000Z'),
      ),
    );
    expect(json).toMatchObject({
      olusturulma: '2026-11-23T12:00:00.000Z',
      hakem: 'DeepSeek',
      model: 'deepseek-flash',
      tekrar: 2,
    });
    expect(json.vakalar).toHaveLength(10);
    const ek = json.vakalar.find((v: { anahtar: string }) => v.anahtar === 'ek-talimat');
    expect(ek).toMatchObject({ kontrol: 'kontrol-zayif', yon: 'yukari', ortalama: 75, kayma: 50 });
    expect(ek.calismalar).toHaveLength(2);
    expect(ek.calismalar[0]).toMatchObject({ tekrar: 1, durum: 'succeeded', toplam: 75 });
    expect(ek.calismalar[0].puanlar[0]).toMatchObject({
      kriter: KEYS[0],
      puan: 4,
      gerekce: 'gerekçe 4',
    });
    const bad = json.vakalar.find((v: { anahtar: string }) => v.anahtar === 'unut-en');
    expect(bad).toMatchObject({ ortalama: null, kayma: null, basarisiz: 2 });
    expect(bad.calismalar[0]).toMatchObject({ durum: 'failed', hataTuru: 'invalid_output' });
  });
});

describe('runInjectionCli', () => {
  function setup(opts: { provider?: LLMProvider; targets?: SmokeTarget[] } = {}) {
    const provider = opts.provider ?? mock();
    const logs: string[] = [];
    const writes: { path: string; data: string }[] = [];
    const deps = {
      targets: opts.targets ?? [target(provider)],
      context,
      write: (path: string, data: string) => {
        writes.push({ path, data });
      },
      now: () => new Date('2026-11-23T12:00:00.000Z'),
    };
    const exec = (...argv: string[]) => runInjectionCli(argv, deps, (line) => logs.push(line));
    return { provider, logs, writes, exec, out: () => logs.join('\n') };
  }

  it('seçeneksiz: yalnızca plan gösterir, hiçbir çağrı yapmaz, 0 döner', async () => {
    const { provider, exec, out } = setup();
    expect(await exec()).toBe(0);
    expect((provider as MockProvider).calls).toHaveLength(0);
    expect(out()).toContain('Toplam çağrı: 30');
    expect(out()).toContain('Gerçek çağrı yapılmadı');
    expect(out()).toContain('--calistir');
  });

  it('--calistir: varsayılan 3 tekrarla 30 çağrı yapar, özeti yazar', async () => {
    const { provider, exec, out } = setup();
    expect(await exec('--calistir')).toBe(0);
    expect((provider as MockProvider).calls).toHaveLength(30);
    expect(out()).toContain('kayma');
    expect(out()).not.toContain('Gerçek çağrı yapılmadı');
  });

  it('--tekrar çağrı sayısını belirler', async () => {
    const { provider, exec } = setup();
    expect(await exec('--calistir', '--tekrar', '1')).toBe(0);
    expect((provider as MockProvider).calls).toHaveLength(10);
  });

  it('hatalı kullanım 2 döner, kullanımı yazar, çağrı yapmaz: geçersiz tekrar, bilinmeyen seçenek, fazladan sözcük', async () => {
    for (const argv of [
      ['--tekrar', '0'],
      ['--tekrar', '11'],
      ['--tekrar', 'x'],
      ['--tekrar', '2.5'],
      ['--yok'],
      ['csv'],
    ]) {
      const { provider, exec, out } = setup();
      expect(await exec(...argv), argv.join(' ')).toBe(2);
      expect(out()).toContain('Kullanım: npm run injection');
      expect((provider as MockProvider).calls).toHaveLength(0);
    }
  });

  it('--cikti yalnızca --calistir ile kullanılır (plan modunda dosya yazılmaz)', async () => {
    const { writes, exec, out } = setup();
    expect(await exec('--cikti', 'x.json')).toBe(2);
    expect(writes).toHaveLength(0);
    expect(out()).toContain('--cikti');
  });

  it('--calistir --cikti: JSON dosyasını yazar ve yolu bildirir', async () => {
    const { writes, exec, out } = setup();
    expect(await exec('--calistir', '--tekrar', '1', '--cikti', 'exports/enjeksiyon.json')).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('exports/enjeksiyon.json');
    const parsed = JSON.parse(writes[0]?.data ?? '');
    expect(parsed.vakalar).toHaveLength(10);
    expect(parsed.olusturulma).toBe('2026-11-23T12:00:00.000Z');
    expect(out()).toContain('exports/enjeksiyon.json');
  });

  it('--hakem etiketi büyük/küçük harfe bakmadan seçer ve yalnızca onu çağırır', async () => {
    const claude = mock();
    const deepseek = mock();
    const { exec } = setup({
      targets: [target(claude, { label: 'Claude', model: 'claude-sonnet-5-5' }), target(deepseek)],
    });
    expect(await exec('--calistir', '--tekrar', '1')).toBe(0); // varsayılan hakem deepseek
    expect(deepseek.calls).toHaveLength(10);
    expect(claude.calls).toHaveLength(0);
    expect(await exec('--hakem', 'CLAUDE', '--calistir', '--tekrar', '1')).toBe(0);
    expect(claude.calls).toHaveLength(10);
  });

  it('istenen hakem kurulu değilse 1 döner, kurulu olanları ve anahtar uyarısını yazar', async () => {
    const { exec, out } = setup({ targets: [target(mock(), { label: 'Claude' })] });
    expect(await exec('--calistir')).toBe(1);
    expect(out()).toContain('Claude');
    expect(out()).toContain('anahtar');
  });

  it('hiç hakem kurulu değilse (anahtarlar tanımsız) 1 döner', async () => {
    const { exec, out } = setup({ targets: [] });
    expect(await exec()).toBe(1);
    expect(out()).toContain('anahtar');
  });

  it('geçersiz cevaplar (saldırıya uyup şemayı bozmak) bulgudur: çıkış kodu 0', async () => {
    const { exec, out } = setup({ provider: mock({ 'unut-en': ['bozuk'] }) });
    expect(await exec('--calistir', '--tekrar', '1')).toBe(0);
    expect(out()).toContain('başarısız 1');
  });

  it('altyapı hatası (anahtar, bakiye, bağlantı) sonuçları eksik bıraktığı için 1 döner ve anahtarı yazmaz', async () => {
    const provider: LLMProvider = {
      id: 'mock',
      generateText: () => Promise.reject(new Error('kullanılmaz')),
      generateJson: () =>
        Promise.reject(new ProviderError('auth', 'HTTP 402 sk-GIZLI-ANAHTAR bakiye')),
    };
    const { exec, out } = setup({ provider });
    expect(await exec('--calistir', '--tekrar', '1')).toBe(1);
    expect(out()).toContain('auth');
    expect(out()).not.toContain('sk-GIZLI-ANAHTAR');
  });

  it('hatalı kullanımda ve planda sağlayıcı hiç çağrılmaz', async () => {
    const generateJson = vi.fn();
    const provider: LLMProvider = { id: 'mock', generateText: vi.fn(), generateJson };
    const { exec } = setup({ provider });
    await exec();
    await exec('--yok');
    expect(generateJson).not.toHaveBeenCalled();
  });
});
