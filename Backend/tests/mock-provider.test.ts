import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ProviderError } from '../src/providers/provider.js';

const request = { model: 'mock-1', prompt: 'Sonbahar hakkında kısa bir şiir yaz.' };

/** Bir söz verinin ProviderError ile bozulduğunu doğrular ve hatayı döner. */
async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('MockProvider: metin üretme', () => {
  it('kimliği mock, cevabı metin ve ölçümleri sayıdır', async () => {
    const provider = new MockProvider();
    const result = await provider.generateText(request);
    expect(provider.id).toBe('mock');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('aynı istek her seferinde aynı cevabı verir, farklı istek farklı cevap verir (deterministik)', async () => {
    const provider = new MockProvider();
    const a1 = await provider.generateText(request);
    const a2 = await provider.generateText(request);
    const b = await provider.generateText({ ...request, prompt: 'Başka bir konu.' });
    expect(a1.text).toBe(a2.text);
    expect(b.text).not.toBe(a1.text);
  });

  it('aldığı istekleri sırayla kaydeder (aynı komutun modellere aynen gittiğini sınamak için)', async () => {
    const provider = new MockProvider();
    await provider.generateText(request);
    await provider.generateText({ ...request, model: 'mock-2' });
    expect(provider.calls.map((c) => c.model)).toEqual(['mock-1', 'mock-2']);
    expect(provider.calls.every((c) => c.prompt === request.prompt)).toBe(true);
  });

  it('cevabı dışarıdan belirlenebilir (eşzamanlı ve eşzamansız)', async () => {
    const sync = new MockProvider({ respond: () => 'hazır cevap' });
    expect((await sync.generateText(request)).text).toBe('hazır cevap');
    const async_ = new MockProvider({ respond: async (req) => `yankı: ${req.model}` });
    expect((await async_.generateText(request)).text).toBe('yankı: mock-1');
  });

  it('T10: boş cevap sessizce kaydedilmez, hata fırlatır (başarısız sayılır, yeniden denenmez)', async () => {
    for (const empty of ['', '   \n']) {
      const error = await providerError(
        new MockProvider({ respond: () => empty }).generateText(request),
      );
      expect(error.kind).toBe('empty_output');
      expect(error.retryable).toBe(false);
    }
  });

  it('T10: cevap hiç yoksa (undefined) "undefined" yazısı metin olarak dönmez', async () => {
    const provider = new MockProvider({ respond: () => undefined as unknown as string });
    const error = await providerError(provider.generateText(request));
    expect(error.kind).toBe('empty_output');
  });

  it('geçici hatalar (kota, zaman aşımı, sunucu) yeniden denenebilir; kalıcı hatalar denenemez', () => {
    for (const kind of ['rate_limit', 'timeout', 'server_error'] as const) {
      expect(new ProviderError(kind, 'x').retryable, kind).toBe(true);
    }
    for (const kind of [
      'auth',
      'invalid_request',
      'safety_blocked',
      'empty_output',
      'invalid_output',
    ] as const) {
      expect(new ProviderError(kind, 'x').retryable, kind).toBe(false);
    }
  });

  it('sağlayıcı hatası (örn. 429 kota) olduğu gibi yukarı iletilir', async () => {
    const provider = new MockProvider({
      respond: () => {
        throw new ProviderError('rate_limit', 'çok fazla istek');
      },
    });
    const error = await providerError(provider.generateText(request));
    expect(error).toMatchObject({ kind: 'rate_limit', retryable: true });
  });
});

describe('MockProvider: yapılandırılmış (JSON) cevap', () => {
  const schema = z.object({ puan: z.number().min(1).max(5), gerekce: z.string() });
  const jsonRequest = { ...request, schema };

  it('şemaya uyan JSON cevabı tipli veri olarak döner', async () => {
    const provider = new MockProvider({ respond: () => '{"puan": 4, "gerekce": "iyi imgeler"}' });
    const result = await provider.generateJson(jsonRequest);
    expect(result.data).toEqual({ puan: 4, gerekce: 'iyi imgeler' });
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('bozuk JSON, şemaya uymayan cevap ve boş cevap ayrı ayrı hata olur, sahte veri üretilmez', async () => {
    const cases: [string, string][] = [
      ['{"puan": 4,', 'invalid_output'],
      ['{"puan": 9, "gerekce": "x"}', 'invalid_output'],
      ['{"gerekce": "x"}', 'invalid_output'],
      ['', 'empty_output'],
    ];
    for (const [answer, kind] of cases) {
      const error = await providerError(
        new MockProvider({ respond: () => answer }).generateJson(jsonRequest),
      );
      expect(error.kind, answer).toBe(kind);
    }
  });

  it('şema hatası alan yolunu söyler ama modelin cevabını mesaja yazmaz', async () => {
    const provider = new MockProvider({ respond: () => '{"puan": 9, "gerekce": "GİZLİ-CEVAP"}' });
    const error = await providerError(provider.generateJson(jsonRequest));
    expect(error.message).toContain('puan');
    expect(error.message).not.toContain('GİZLİ-CEVAP');
  });
});
