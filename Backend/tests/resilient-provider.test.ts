import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ProviderError, type ProviderErrorKind } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';

const request = { model: 'mock-1', prompt: 'Sonbahar hakkında kısa bir şiir yaz.' };

/** Önce verilen hataları sırayla fırlatır, sonra "tamam" döner. */
function flaky(failures: ProviderError[]) {
  let i = 0;
  return () => {
    const failure = failures[i++];
    if (failure) throw failure;
    return 'tamam';
  };
}

const fail = (kind: ProviderErrorKind, options?: { retryAfterMs?: number }) =>
  new ProviderError(kind, `${kind} hatası`, options);

describe('dayanıklı sağlayıcı: yeniden deneme', () => {
  let sleeps: number[];
  const sleep = async (ms: number) => {
    sleeps.push(ms); // beklemeden kaydeder, testler hızlı kalır
  };
  beforeEach(() => {
    sleeps = [];
  });

  it('ilk denemede başarılıysa beklemez ve tek çağrı yapar', async () => {
    const mock = new MockProvider({ respond: () => 'ilk seferde' });
    const provider = withResilience(mock, { sleep });
    expect((await provider.generateText(request)).text).toBe('ilk seferde');
    expect(mock.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('kimliği sarmalanan sağlayıcıyla aynıdır', () => {
    expect(withResilience(new MockProvider()).id).toBe('mock');
  });

  it('T08: kota (429) hatasında üstel geri çekilmeyle yeniden dener (1 sn, 2 sn) ve başarır', async () => {
    const mock = new MockProvider({ respond: flaky([fail('rate_limit'), fail('rate_limit')]) });
    const provider = withResilience(mock, { sleep });
    expect((await provider.generateText(request)).text).toBe('tamam');
    expect(mock.calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('her denemede aynı istek gider (komut değişmez)', async () => {
    const mock = new MockProvider({ respond: flaky([fail('server_error'), fail('timeout')]) });
    await withResilience(mock, { sleep }).generateText(request);
    expect(mock.calls.map((c) => c.prompt)).toEqual([
      request.prompt,
      request.prompt,
      request.prompt,
    ]);
  });

  it('deneme hakkı bitince son hatayı olduğu gibi fırlatır, son denemeden sonra beklemez', async () => {
    const mock = new MockProvider({
      respond: () => {
        throw fail('server_error');
      },
    });
    const provider = withResilience(mock, { sleep, maxAttempts: 3 });
    await expect(provider.generateText(request)).rejects.toMatchObject({
      kind: 'server_error',
      retryable: true,
    });
    expect(mock.calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]); // 3. denemeden sonra bekleme yok
  });

  it('T09: kalıcı hatalar (anahtar, güvenlik filtresi, boş/bozuk cevap) yeniden denenmez', async () => {
    for (const kind of [
      'auth',
      'invalid_request',
      'safety_blocked',
      'empty_output',
      'invalid_output',
    ] as const) {
      const mock = new MockProvider({
        respond: () => {
          throw fail(kind);
        },
      });
      await expect(withResilience(mock, { sleep }).generateText(request)).rejects.toMatchObject({
        kind,
      });
      expect(mock.calls, kind).toHaveLength(1);
    }
    expect(sleeps).toEqual([]);
  });

  it('beklemeyi üst sınırla kırpar (1, 2, 4, 8 sn... en çok maxDelayMs)', async () => {
    const mock = new MockProvider({
      respond: () => {
        throw fail('timeout');
      },
    });
    const provider = withResilience(mock, {
      sleep,
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 3000,
    });
    await expect(provider.generateText(request)).rejects.toBeInstanceOf(ProviderError);
    expect(sleeps).toEqual([1000, 2000, 3000, 3000]);
  });

  it('sağlayıcı "şu kadar sonra tekrar dene" derse (Retry-After) daha uzun olanı bekler, üst sınırı aşmaz', async () => {
    const mock = new MockProvider({
      respond: flaky([
        fail('rate_limit', { retryAfterMs: 20_000 }),
        fail('rate_limit', { retryAfterMs: 999_000 }),
      ]),
    });
    await withResilience(mock, { sleep, maxDelayMs: 30_000 }).generateText(request);
    expect(sleeps).toEqual([20_000, 30_000]);
  });

  it('yapılandırılmış (JSON) istek de aynı kuralla yeniden denenir', async () => {
    let calls = 0;
    const mock = new MockProvider({
      respond: () => {
        if (calls++ === 0) throw fail('rate_limit');
        return '{"puan": 4}';
      },
    });
    const provider = withResilience(mock, { sleep });
    const result = await provider.generateJson({
      ...request,
      schema: z.object({ puan: z.number() }),
    });
    expect(result.data).toEqual({ puan: 4 });
    expect(sleeps).toEqual([1000]);
  });

  it('bozuk JSON yeniden denenmez (aynı soru aynı bozuk cevabı verir; karar yargıç katmanında)', async () => {
    const mock = new MockProvider({ respond: () => '{"puan": ' });
    const provider = withResilience(mock, { sleep });
    await expect(
      provider.generateJson({ ...request, schema: z.object({ puan: z.number() }) }),
    ).rejects.toMatchObject({ kind: 'invalid_output' });
    expect(mock.calls).toHaveLength(1);
  });
});

describe('dayanıklı sağlayıcı: zaman aşımı', () => {
  const sleep = async () => {};

  it('süresi içinde cevap vermeyen çağrıyı keser, iptal sinyali gönderir ve timeout hatası verir', async () => {
    const signals: AbortSignal[] = [];
    const mock = new MockProvider({
      respond: (req) => {
        if (req.signal) signals.push(req.signal);
        return new Promise<string>(() => {}); // hiç cevap vermez
      },
    });
    const provider = withResilience(mock, { sleep, timeoutMs: 20, maxAttempts: 2 });
    await expect(provider.generateText(request)).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
    expect(mock.calls).toHaveLength(2); // zaman aşımı geçici hata: yeniden denendi
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('bir deneme zaman aşımına uğrayıp sonrakinde cevap gelirse başarır', async () => {
    let first = true;
    const mock = new MockProvider({
      respond: () => {
        if (first) {
          first = false;
          return new Promise<string>(() => {});
        }
        return 'geç de olsa geldi';
      },
    });
    const provider = withResilience(mock, { sleep, timeoutMs: 20 });
    expect((await provider.generateText(request)).text).toBe('geç de olsa geldi');
    expect(mock.calls).toHaveLength(2);
  });

  it('hızlı cevapta zaman aşımı sayacı işleri bozmaz (sinyal iptal edilmez)', async () => {
    let signal: AbortSignal | undefined;
    const mock = new MockProvider({
      respond: (req) => {
        signal = req.signal;
        return 'hızlı';
      },
    });
    await withResilience(mock, { sleep, timeoutMs: 1000 }).generateText(request);
    expect(signal?.aborted).toBe(false);
  });
});
