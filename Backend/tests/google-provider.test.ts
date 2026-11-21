import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GoogleProvider } from '../src/providers/google-provider.js';
import { ProviderError } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';
import { fakeFetch, hangingResponse, jsonResponse, type FakeCall } from './support/fake-fetch.js';

const request = { model: 'gemini-3.5-flash-lite', prompt: 'Sonbahar hakkında kısa bir şiir yaz.' };

/** Gemini generateContent'in başarılı cevabı biçiminde sahte cevap. */
const reply = (over: Record<string, unknown> = {}) => ({
  candidates: [
    {
      content: { role: 'model', parts: [{ text: 'Yaprak yaprak döküldü gün.' }] },
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 12,
    candidatesTokenCount: 30,
    thoughtsTokenCount: 4,
    totalTokenCount: 46,
  },
  ...over,
});

const apiError = (code: number, status: string, text = 'hata ayrıntısı') => ({
  error: { code, message: text, status },
});

function provider(handler: (call: FakeCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  return { provider: new GoogleProvider({ apiKey: 'test-anahtar', fetch: fake.fetch }), ...fake };
}

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('Gemini adaptörü: metin üretme', () => {
  it('isteği doğru biçimde gönderir, anahtar başlıkta gider (adreste değil)', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(200, reply()));
    const result = await p.generateText(request);

    expect(p.id).toBe('google');
    expect(result.text).toBe('Yaprak yaprak döküldü gün.');
    // Düşünme tokenleri de çıktı olarak ücretlendirilir: 30 + 4
    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 34 });

    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(calls[0]?.url).not.toContain('test-anahtar');
    expect(calls[0]?.headers.get('x-goog-api-key')).toBe('test-anahtar');
    expect(calls[0]?.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    });
  });

  it('sistem komutu, sıcaklık ve token sınırı yalnızca verildiyse gönderilir', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(200, reply()));
    await p.generateText({
      ...request,
      system: 'Sen bir şairsin.',
      temperature: 0.7,
      maxTokens: 500,
    });
    expect(calls[0]?.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      systemInstruction: { parts: [{ text: 'Sen bir şairsin.' }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
    });
  });

  it('birden çok parçayı birleştirir, düşünme özeti parçalarını yok sayar', async () => {
    const parts = [{ text: 'iç ses', thought: true }, { text: 'Birinci ' }, { text: 'ikinci.' }];
    const { provider: p } = provider(() =>
      jsonResponse(200, reply({ candidates: [{ content: { parts }, finishReason: 'STOP' }] })),
    );
    expect((await p.generateText(request)).text).toBe('Birinci ikinci.');
  });

  it('HTTP hataları sağlayıcı hatasına çevrilir ve iletiyi taşır', async () => {
    const cases: [number, string, string][] = [
      [429, 'RESOURCE_EXHAUSTED', 'rate_limit'],
      [503, 'UNAVAILABLE', 'server_error'],
      [500, 'INTERNAL', 'server_error'],
      [403, 'PERMISSION_DENIED', 'auth'],
      [401, 'UNAUTHENTICATED', 'auth'],
      [400, 'INVALID_ARGUMENT', 'invalid_request'],
      [404, 'NOT_FOUND', 'invalid_request'],
    ];
    for (const [status, label, kind] of cases) {
      const { provider: p } = provider(() =>
        jsonResponse(status, apiError(status, label, 'özel ileti')),
      );
      const error = await providerError(p.generateText(request));
      expect(error.kind, String(status)).toBe(kind);
      expect(error.message).toContain('özel ileti');
    }
  });

  it('gövdesi JSON olmayan hata cevabı da (HTML hata sayfası gibi) çevrilir', async () => {
    const { provider: p } = provider(
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    expect(await providerError(p.generateText(request))).toMatchObject({
      kind: 'server_error',
      retryable: true,
    });
  });

  it('Retry-After başlığı varsa hataya geçirilir', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(429, apiError(429, 'RESOURCE_EXHAUSTED'), { 'retry-after': '5' }),
    );
    expect((await providerError(p.generateText(request))).retryAfterMs).toBe(5000);
  });

  it('hata mesajı API anahtarını içermez', async () => {
    const { provider: p } = provider(() => jsonResponse(403, apiError(403, 'PERMISSION_DENIED')));
    expect((await providerError(p.generateText(request))).message).not.toContain('test-anahtar');
  });

  it('ağ kopması geçici sunucu hatası sayılır', async () => {
    const { provider: p } = provider(() => {
      throw new TypeError('fetch failed');
    });
    expect(await providerError(p.generateText(request))).toMatchObject({
      kind: 'server_error',
      retryable: true,
    });
  });

  it('iptal sinyali isteğe iletilir ve iptal edilince zaman aşımı hatası verir', async () => {
    const { provider: p, calls } = provider(hangingResponse);
    const controller = new AbortController();
    const pending = p.generateText({ ...request, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    expect((await providerError(pending)).kind).toBe('timeout');
    expect(calls[0]?.signal).toBeDefined();
  });

  it('güvenlik filtreleri safety_blocked olur, yeniden denenmez', async () => {
    // İstek baştan engellenirse aday dönmez, nedeni promptFeedback'te yazar.
    const blockedPrompt = reply({
      candidates: undefined,
      promptFeedback: { blockReason: 'SAFETY' },
    });
    const a = provider(() => jsonResponse(200, blockedPrompt));
    expect(await providerError(a.provider.generateText(request))).toMatchObject({
      kind: 'safety_blocked',
      retryable: false,
    });

    // Cevap üretilirken kesilirse aday gelir ama finishReason güvenlik nedenidir.
    for (const finishReason of [
      'SAFETY',
      'RECITATION',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
    ]) {
      const b = provider(() =>
        jsonResponse(200, reply({ candidates: [{ content: { parts: [] }, finishReason }] })),
      );
      expect((await providerError(b.provider.generateText(request))).kind, finishReason).toBe(
        'safety_blocked',
      );
    }
  });

  it('token sınırında kesilen cevap tam metin gibi kaydedilmez (düşünme tokenleri sınırı yiyebilir)', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(
        200,
        reply({
          candidates: [{ content: { parts: [{ text: 'yarım' }] }, finishReason: 'MAX_TOKENS' }],
        }),
      ),
    );
    const error = await providerError(p.generateText(request));
    expect(error.kind).toBe('invalid_output');
    expect(error.message).toContain('maxTokens');
  });

  it('aday yoksa ya da metin boşsa empty_output olur (T10)', async () => {
    for (const body of [
      reply({ candidates: [] }),
      reply({ candidates: undefined }),
      reply({ candidates: [{ content: { parts: [{ text: ' ' }] }, finishReason: 'STOP' }] }),
    ]) {
      const { provider: p } = provider(() => jsonResponse(200, body));
      expect((await providerError(p.generateText(request))).kind).toBe('empty_output');
    }
  });
});

describe('Gemini adaptörü: yapılandırılmış (JSON) cevap', () => {
  const schema = z.object({ puan: z.number().min(1).max(5), gerekce: z.string() });
  const jsonRequest = { ...request, schema };
  const answer = (text: string) =>
    jsonResponse(
      200,
      reply({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
    );

  it('şemaya uyan cevabı tipli veri olarak döner ve JSON şemasını isteğe ekler', async () => {
    const { provider: p, calls } = provider(() => answer('{"puan": 4, "gerekce": "iyi imgeler"}'));
    const result = await p.generateJson(jsonRequest);
    expect(result.data).toEqual({ puan: 4, gerekce: 'iyi imgeler' });

    const config = (calls[0]?.body as { generationConfig: Record<string, unknown> })
      .generationConfig;
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseJsonSchema).toMatchObject({
      type: 'object',
      properties: { puan: { type: 'number' }, gerekce: { type: 'string' } },
    });
    expect(config.responseJsonSchema).not.toHaveProperty('$schema'); // API bu anahtarı istemez
  });

  it('bozuk JSON ve şemaya uymayan cevap invalid_output olur, cevap metni hataya sızmaz', async () => {
    for (const text of [
      '{"puan": 4,',
      '{"puan": 9, "gerekce": "GİZLİ-CEVAP"}',
      '{"gerekce": "x"}',
    ]) {
      const { provider: p } = provider(() => answer(text));
      const error = await providerError(p.generateJson(jsonRequest));
      expect(error.kind, text).toBe('invalid_output');
      expect(error.message).not.toContain('GİZLİ-CEVAP');
    }
  });
});

describe('Gemini adaptörü + koruyucu kılıf', () => {
  it('429 sonrası bekleyip yeniden dener ve başarır (T08)', async () => {
    let n = 0;
    const { provider: p, calls } = provider(() =>
      n++ === 0
        ? jsonResponse(429, apiError(429, 'RESOURCE_EXHAUSTED'))
        : jsonResponse(200, reply()),
    );
    const sleeps: number[] = [];
    const safe = withResilience(p, { sleep: async (ms) => void sleeps.push(ms) });
    expect((await safe.generateText(request)).text).toBe('Yaprak yaprak döküldü gün.');
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('yanlış anahtar (403) yeniden denenmez', async () => {
    const { provider: p, calls } = provider(() =>
      jsonResponse(403, apiError(403, 'PERMISSION_DENIED')),
    );
    await providerError(withResilience(p, { sleep: async () => {} }).generateText(request));
    expect(calls).toHaveLength(1);
  });
});
