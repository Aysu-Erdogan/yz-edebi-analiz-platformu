import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from '../src/providers/anthropic-provider.js';
import { ProviderError } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';
import { fakeFetch, hangingResponse, jsonResponse, type FakeCall } from './support/fake-fetch.js';

const request = { model: 'claude-haiku-5-5', prompt: 'Sonbahar hakkında kısa bir şiir yaz.' };

/** Anthropic Messages API'nin başarılı cevabı biçiminde sahte cevap. */
const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: 'Yaprak yaprak döküldü gün.' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 34 },
  ...over,
});

const apiError = (type: string, text = 'hata ayrıntısı') => ({
  type: 'error',
  error: { type, message: text },
});

function provider(handler: (call: FakeCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  return {
    provider: new AnthropicProvider({ apiKey: 'test-anahtar', fetch: fake.fetch }),
    ...fake,
  };
}

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('Claude adaptörü: metin üretme', () => {
  it('isteği doğru biçimde gönderir ve metni ile ölçümleri döner', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(200, message()));
    const result = await p.generateText(request);

    expect(p.id).toBe('anthropic');
    expect(result.text).toBe('Yaprak yaprak döküldü gün.');
    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 34 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/v1/messages');
    // Anahtar bir başlıkta gider (hangisi olduğu kütüphaneye bağlı), adreste asla.
    expect([...(calls[0]?.headers.values() ?? [])].some((v) => v.includes('test-anahtar'))).toBe(
      true,
    );
    expect(calls[0]?.url).not.toContain('test-anahtar');
    expect(calls[0]?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: request.prompt }],
    });
  });

  it('sistem komutu, sıcaklık ve token sınırı yalnızca verildiyse gönderilir', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(200, message()));
    await p.generateText(request);
    expect(calls[0]?.body).not.toHaveProperty('system');
    expect(calls[0]?.body).not.toHaveProperty('temperature'); // yeni modeller 400 verir

    await p.generateText({
      ...request,
      system: 'Sen bir şairsin.',
      temperature: 0.7,
      maxTokens: 500,
    });
    expect(calls[1]?.body).toMatchObject({
      system: 'Sen bir şairsin.',
      temperature: 0.7,
      max_tokens: 500,
    });
  });

  it('birden çok metin bloğunu birleştirir, metin dışı blokları (düşünme) yok sayar', async () => {
    const content = [
      { type: 'thinking', thinking: 'iç ses', signature: 'x' },
      { type: 'text', text: 'Birinci ' },
      { type: 'text', text: 'ikinci.' },
    ];
    const { provider: p } = provider(() => jsonResponse(200, message({ content })));
    expect((await p.generateText(request)).text).toBe('Birinci ikinci.');
  });

  it('SDK kendi yeniden denemesini yapmaz (bunu dış katman yapar): 429 tek istekle biter', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(429, apiError('rate_limit_error')));
    await providerError(p.generateText(request));
    expect(calls).toHaveLength(1);
  });

  it('HTTP hataları sağlayıcı hatasına çevrilir', async () => {
    const cases: [number, string, string][] = [
      [429, 'rate_limit_error', 'rate_limit'],
      [401, 'authentication_error', 'auth'],
      [403, 'permission_error', 'auth'],
      [400, 'invalid_request_error', 'invalid_request'],
      [404, 'not_found_error', 'invalid_request'],
      [500, 'api_error', 'server_error'],
      [529, 'overloaded_error', 'server_error'],
    ];
    for (const [status, type, kind] of cases) {
      const { provider: p } = provider(() => jsonResponse(status, apiError(type)));
      const error = await providerError(p.generateText(request));
      expect(error.kind, String(status)).toBe(kind);
    }
  });

  it('Retry-After başlığı hataya geçirilir', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(429, apiError('rate_limit_error'), { 'retry-after': '7' }),
    );
    expect((await providerError(p.generateText(request))).retryAfterMs).toBe(7000);
  });

  it('hata mesajı API anahtarını içermez', async () => {
    const { provider: p } = provider(() => jsonResponse(401, apiError('authentication_error')));
    expect((await providerError(p.generateText(request))).message).not.toContain('test-anahtar');
  });

  it('ağ kopması (fetch hatası) geçici sunucu hatası sayılır', async () => {
    const { provider: p } = provider(() => {
      throw new TypeError('fetch failed');
    });
    const error = await providerError(p.generateText(request));
    expect(error).toMatchObject({ kind: 'server_error', retryable: true });
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

  it('güvenlik nedeniyle reddedilen cevap safety_blocked olur, yeniden denenmez', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(200, message({ content: [], stop_reason: 'refusal' })),
    );
    const error = await providerError(p.generateText(request));
    expect(error).toMatchObject({ kind: 'safety_blocked', retryable: false });
  });

  it('token sınırında kesilen cevap tam metin gibi kaydedilmez (invalid_output)', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(200, message({ stop_reason: 'max_tokens' })),
    );
    const error = await providerError(p.generateText(request));
    expect(error.kind).toBe('invalid_output');
    expect(error.message).toContain('maxTokens');
  });

  it('boş metin empty_output olur (T10)', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(200, message({ content: [{ type: 'text', text: '  ' }] })),
    );
    expect((await providerError(p.generateText(request))).kind).toBe('empty_output');
  });
});

describe('Claude adaptörü: yapılandırılmış (JSON) cevap', () => {
  const schema = z.object({ puan: z.number().min(1).max(5), gerekce: z.string() });
  const jsonRequest = { ...request, schema };
  const answer = (text: string) =>
    jsonResponse(200, message({ content: [{ type: 'text', text }] }));

  it('şemaya uyan cevabı tipli veri olarak döner ve şemayı isteğe ekler', async () => {
    const { provider: p, calls } = provider(() => answer('{"puan": 4, "gerekce": "iyi imgeler"}'));
    const result = await p.generateJson(jsonRequest);
    expect(result.data).toEqual({ puan: 4, gerekce: 'iyi imgeler' });
    expect(result.outputTokens).toBe(34);
    expect(calls[0]?.body).toMatchObject({
      output_config: { format: { type: 'json_schema' } },
    });
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

  it('reddedilen ve kesilen cevaplar JSON isteğinde de hata olur', async () => {
    const refused = provider(() =>
      jsonResponse(200, message({ content: [], stop_reason: 'refusal' })),
    );
    expect((await providerError(refused.provider.generateJson(jsonRequest))).kind).toBe(
      'safety_blocked',
    );
    const cut = provider(() => jsonResponse(200, message({ stop_reason: 'max_tokens' })));
    expect((await providerError(cut.provider.generateJson(jsonRequest))).kind).toBe(
      'invalid_output',
    );
  });
});

describe('Claude adaptörü + koruyucu kılıf', () => {
  it('429 sonrası bekleyip yeniden dener ve başarır (T08), her istekte aynı komut gider', async () => {
    let n = 0;
    const { provider: p, calls } = provider(() =>
      n++ === 0 ? jsonResponse(429, apiError('rate_limit_error')) : jsonResponse(200, message()),
    );
    const sleeps: number[] = [];
    const safe = withResilience(p, { sleep: async (ms) => void sleeps.push(ms) });
    expect((await safe.generateText(request)).text).toBe('Yaprak yaprak döküldü gün.');
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
    expect(calls.map((c) => (c.body as { messages: unknown }).messages)).toEqual([
      [{ role: 'user', content: request.prompt }],
      [{ role: 'user', content: request.prompt }],
    ]);
  });

  it('yanlış anahtar (401) yeniden denenmez', async () => {
    const { provider: p, calls } = provider(() =>
      jsonResponse(401, apiError('authentication_error')),
    );
    const safe = withResilience(p, { sleep: async () => {} });
    await providerError(safe.generateText(request));
    expect(calls).toHaveLength(1);
  });
});
