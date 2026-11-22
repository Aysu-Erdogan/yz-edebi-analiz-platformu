import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAIProvider } from '../src/providers/openai-provider.js';
import { ProviderError } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';
import { fakeFetch, hangingResponse, jsonResponse, type FakeCall } from './support/fake-fetch.js';

const request = { model: 'gpt-6.2-sol', prompt: 'Sonbahar hakkında kısa bir şiir yaz.' };

const message = (...parts: unknown[]) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: parts,
});
const text = (value: string) => ({ type: 'output_text', text: value });

/** Responses API'nin başarılı cevabı biçiminde sahte cevap. */
const reply = (over: Record<string, unknown> = {}) => ({
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  output: [{ type: 'reasoning', summary: [] }, message(text('Yaprak yaprak döküldü gün.'))],
  usage: {
    input_tokens: 12,
    output_tokens: 34,
    output_tokens_details: { reasoning_tokens: 4 },
    total_tokens: 46,
  },
  ...over,
});

const apiError = (type: string, msg = 'hata ayrıntısı') => ({
  error: { message: msg, type, param: null, code: null },
});

function provider(handler: (call: FakeCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  return { provider: new OpenAIProvider({ apiKey: 'test-anahtar', fetch: fake.fetch }), ...fake };
}

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('OpenAI adaptörü: metin üretme', () => {
  it('isteği doğru biçimde gönderir, anahtar başlıkta gider (adreste değil)', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(200, reply()));
    const result = await p.generateText(request);

    expect(p.id).toBe('openai');
    expect(result.text).toBe('Yaprak yaprak döküldü gün.');
    // Düşünme tokenleri output_tokens'a zaten dahildir: yeniden eklenmez.
    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 34 });

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0]?.url).not.toContain('test-anahtar');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-anahtar');
    // store:false → üretilen metinler OpenAI tarafında saklanmaz.
    expect(calls[0]?.body).toEqual({ model: 'gpt-6.2-sol', input: request.prompt, store: false });
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
      model: 'gpt-6.2-sol',
      input: request.prompt,
      store: false,
      instructions: 'Sen bir şairsin.',
      temperature: 0.7,
      max_output_tokens: 500,
    });
  });

  it('birden çok mesaj ve parçayı birleştirir, düşünme öğelerini yok sayar', async () => {
    const output = [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'iç ses' }] },
      message(text('Birinci '), text('ikinci ')),
      message(text('üçüncü.')),
    ];
    const { provider: p } = provider(() => jsonResponse(200, reply({ output })));
    expect((await p.generateText(request)).text).toBe('Birinci ikinci üçüncü.');
  });

  it('HTTP hataları sağlayıcı hatasına çevrilir ve iletiyi taşır', async () => {
    const cases: [number, string, string][] = [
      [429, 'rate_limit_error', 'rate_limit'],
      [503, 'server_error', 'server_error'],
      [500, 'server_error', 'server_error'],
      [401, 'invalid_request_error', 'auth'],
      [403, 'invalid_request_error', 'auth'],
      [400, 'invalid_request_error', 'invalid_request'],
      [404, 'invalid_request_error', 'invalid_request'],
    ];
    for (const [status, type, kind] of cases) {
      const { provider: p } = provider(() => jsonResponse(status, apiError(type, 'özel ileti')));
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
      jsonResponse(429, apiError('rate_limit_error'), { 'retry-after': '5' }),
    );
    expect((await providerError(p.generateText(request))).retryAfterMs).toBe(5000);
  });

  it('429 ile gelen "kredi kalmadı" (insufficient_quota, credit_balance_exhausted) geçici kota değil kalıcı bakiye hatasıdır: yeniden denenmez', async () => {
    // Gerçek denemede (22 Kas) hesapta kredi yokken OpenAI 429 döndü; bekleyip denemek boşuna.
    const bodies = [
      {
        message: 'You have no credits remaining.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
      { message: 'You have no credits remaining.', type: 'insufficient_quota', code: null },
      // Gerçek cevap (22 Kas, llm:smoke): kod `credit_balance_exhausted`, tür `insufficient_quota`.
      {
        message: 'You have no credits remaining.',
        type: 'insufficient_quota',
        code: 'credit_balance_exhausted',
      },
      // Tür bir gün değişirse bile yeni kod tek başına yeter.
      {
        message: 'You have no credits remaining.',
        type: 'billing_error',
        code: 'credit_balance_exhausted',
      },
      {
        message: 'You have no credits remaining.',
        type: 'billing_error',
        code: 'insufficient_quota',
      },
    ];
    for (const error of bodies) {
      const { provider: p, calls } = provider(() => jsonResponse(429, { error }));
      const safe = withResilience(p, { sleep: async () => {} });
      const thrown = await providerError(safe.generateText(request));
      expect(thrown, JSON.stringify(error)).toMatchObject({ kind: 'auth', retryable: false });
      expect(thrown.message).toContain('no credits remaining');
      expect(calls).toHaveLength(1);
    }
  });

  it('gerçek bir kota/hız sınırı (429) hâlâ geçici sayılır ve hata kodu iletide görünür', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(429, {
        error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' },
      }),
    );
    const error = await providerError(p.generateText(request));
    expect(error).toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(error.message).toContain('[rate_limit_exceeded]');
  });

  it('hata mesajı API anahtarını içermez', async () => {
    const { provider: p } = provider(() => jsonResponse(401, apiError('invalid_request_error')));
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

  it('reddedilen cevap safety_blocked olur, yeniden denenmez, ret metni hataya sızmaz', async () => {
    const output = [message({ type: 'refusal', refusal: 'GİZLİ-RET-METNİ' })];
    const { provider: p } = provider(() => jsonResponse(200, reply({ output })));
    const error = await providerError(p.generateText(request));
    expect(error).toMatchObject({ kind: 'safety_blocked', retryable: false });
    expect(error.message).not.toContain('GİZLİ-RET-METNİ');
  });

  it('token sınırında kesilen cevap tam metin gibi kaydedilmez (düşünme tokenleri sınırı yiyebilir)', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(
        200,
        reply({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [message(text('yarım'))],
        }),
      ),
    );
    const error = await providerError(p.generateText(request));
    expect(error.kind).toBe('invalid_output');
    expect(error.message).toContain('maxTokens');
  });

  it('içerik filtresi kesmesi safety_blocked olur', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(
        200,
        reply({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }),
      ),
    );
    expect(await providerError(p.generateText(request))).toMatchObject({
      kind: 'safety_blocked',
      retryable: false,
    });
  });

  it('başarısız (failed) cevap geçici sunucu hatası sayılır, sahte metin üretilmez', async () => {
    const { provider: p } = provider(() =>
      jsonResponse(
        200,
        reply({ status: 'failed', error: { code: 'server_error', message: 'iç hata' } }),
      ),
    );
    expect(await providerError(p.generateText(request))).toMatchObject({
      kind: 'server_error',
      retryable: true,
    });
  });

  it('çıktı yoksa ya da metin boşsa empty_output olur (T10)', async () => {
    for (const output of [[], [{ type: 'reasoning', summary: [] }], [message(text(' '))]]) {
      const { provider: p } = provider(() => jsonResponse(200, reply({ output })));
      expect((await providerError(p.generateText(request))).kind).toBe('empty_output');
    }
  });
});

describe('OpenAI adaptörü: yapılandırılmış (JSON) cevap', () => {
  const schema = z.object({ puan: z.number().min(1).max(5), gerekce: z.string() });
  const jsonRequest = { ...request, schema };
  const answer = (value: string) => jsonResponse(200, reply({ output: [message(text(value))] }));

  it('şemaya uyan cevabı tipli veri olarak döner ve JSON şemasını isteğe ekler', async () => {
    const { provider: p, calls } = provider(() => answer('{"puan": 4, "gerekce": "iyi imgeler"}'));
    const result = await p.generateJson(jsonRequest);
    expect(result.data).toEqual({ puan: 4, gerekce: 'iyi imgeler' });

    const format = (calls[0]?.body as { text: { format: Record<string, unknown> } }).text.format;
    expect(format).toMatchObject({ type: 'json_schema', name: 'sonuc', strict: true });
    expect(format.schema).toMatchObject({
      type: 'object',
      properties: { puan: { type: 'number' }, gerekce: { type: 'string' } },
      required: ['puan', 'gerekce'],
      additionalProperties: false, // strict kip her nesnede bunu ister
    });
    expect(format.schema).not.toHaveProperty('$schema');
  });

  it('bozuk JSON ve şemaya uymayan cevap invalid_output olur, cevap metni hataya sızmaz', async () => {
    for (const body of [
      '{"puan": 4,',
      '{"puan": 9, "gerekce": "GİZLİ-CEVAP"}',
      '{"gerekce": "x"}',
    ]) {
      const { provider: p } = provider(() => answer(body));
      const error = await providerError(p.generateJson(jsonRequest));
      expect(error.kind, body).toBe('invalid_output');
      expect(error.message).not.toContain('GİZLİ-CEVAP');
    }
  });
});

describe('OpenAI adaptörü + koruyucu kılıf', () => {
  it('429 sonrası bekleyip yeniden dener ve başarır (T08)', async () => {
    let n = 0;
    const { provider: p, calls } = provider(() =>
      n++ === 0 ? jsonResponse(429, apiError('rate_limit_error')) : jsonResponse(200, reply()),
    );
    const sleeps: number[] = [];
    const safe = withResilience(p, { sleep: async (ms) => void sleeps.push(ms) });
    expect((await safe.generateText(request)).text).toBe('Yaprak yaprak döküldü gün.');
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('yanlış anahtar (401) yeniden denenmez', async () => {
    const { provider: p, calls } = provider(() =>
      jsonResponse(401, apiError('invalid_request_error')),
    );
    await providerError(withResilience(p, { sleep: async () => {} }).generateText(request));
    expect(calls).toHaveLength(1);
  });
});
