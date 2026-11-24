import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DeepSeekProvider } from '../src/providers/deepseek-provider.js';
import { ProviderError } from '../src/providers/provider.js';
import { withResilience } from '../src/providers/resilient-provider.js';
import { fakeFetch, hangingResponse, jsonResponse, type FakeCall } from './support/fake-fetch.js';

const request = { model: 'deepseek-flash', prompt: 'Sonbahar hakkında kısa bir şiir yaz.' };

/** Chat Completions cevabı biçiminde sahte cevap. */
const reply = (
  content: unknown = 'Yaprak yaprak döküldü gün.',
  over: Record<string, unknown> = {},
) => ({
  id: 'cmpl_1',
  object: 'chat.completion',
  model: 'deepseek-flash',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
  ...over,
});

/** Tek seçenekli cevap; bitiş nedenini değiştirmek için. */
const finishing = (finish_reason: string, content: unknown = 'yarım') =>
  reply(content, { choices: [{ index: 0, message: { content }, finish_reason }] });

const apiError = (msg = 'hata ayrıntısı') => ({ error: { message: msg, type: 'x', code: null } });

function provider(handler: (call: FakeCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  return { provider: new DeepSeekProvider({ apiKey: 'test-anahtar', fetch: fake.fetch }), ...fake };
}

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('DeepSeek adaptörü: metin üretme', () => {
  it('isteği doğru biçimde gönderir, anahtar başlıkta gider (adreste değil), düşünme kapalıdır', async () => {
    const { provider: p, calls } = provider(() => jsonResponse(200, reply()));
    const result = await p.generateText(request);

    expect(p.id).toBe('deepseek');
    expect(result.text).toBe('Yaprak yaprak döküldü gün.');
    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 34 });

    expect(calls[0]?.url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0]?.url).not.toContain('test-anahtar');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-anahtar');
    // Düşünme kapalı: sıcaklık işe yarar, düşünme tokenleri faturaya girmez.
    expect(calls[0]?.body).toEqual({
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: request.prompt }],
      thinking: { type: 'disabled' },
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
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: 'Sen bir şairsin.' },
        { role: 'user', content: request.prompt },
      ],
      thinking: { type: 'disabled' },
      temperature: 0.7,
      max_tokens: 500,
    });
  });

  it('cevap gövdesinin başındaki boş satırları (bekleme sinyali) yok sayar', async () => {
    // DeepSeek yavaş cevapta bağlantıyı açık tutmak için gövdenin başına boş satır yazar.
    const { provider: p } = provider(
      () => new Response(`\n\n\n${JSON.stringify(reply())}`, { status: 200 }),
    );
    expect((await p.generateText(request)).text).toBe('Yaprak yaprak döküldü gün.');
  });

  it('düşünme içeriği (reasoning_content) cevap metnine karışmaz', async () => {
    const message = { role: 'assistant', content: 'asıl cevap', reasoning_content: 'iç ses' };
    const { provider: p } = provider(() =>
      jsonResponse(200, reply('x', { choices: [{ index: 0, message, finish_reason: 'stop' }] })),
    );
    expect((await p.generateText(request)).text).toBe('asıl cevap');
  });

  it('HTTP hataları sağlayıcı hatasına çevrilir ve iletiyi taşır', async () => {
    const cases: [number, string][] = [
      [429, 'rate_limit'],
      [503, 'server_error'],
      [500, 'server_error'],
      [401, 'auth'],
      [402, 'auth'], // bakiye bitti: beklemek çözmez
      [400, 'invalid_request'],
      [422, 'invalid_request'],
    ];
    for (const [status, kind] of cases) {
      const { provider: p } = provider(() => jsonResponse(status, apiError('özel ileti')));
      const error = await providerError(p.generateText(request));
      expect(error.kind, String(status)).toBe(kind);
      expect(error.message).toContain('özel ileti');
    }
  });

  it('gövdesi JSON olmayan hata cevabı da çevrilir', async () => {
    const { provider: p } = provider(() => new Response('Server Overloaded', { status: 503 }));
    expect(await providerError(p.generateText(request))).toMatchObject({
      kind: 'server_error',
      retryable: true,
    });
  });

  it('Retry-After başlığı varsa hataya geçirilir', async () => {
    const { provider: p } = provider(() => jsonResponse(429, apiError(), { 'retry-after': '5' }));
    expect((await providerError(p.generateText(request))).retryAfterMs).toBe(5000);
  });

  it('hata mesajı API anahtarını içermez', async () => {
    const { provider: p } = provider(() => jsonResponse(401, apiError()));
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

  it('gövdesi yarıda kesilmiş (okunamayan) cevap geçici sunucu hatası sayılır, kod hatası gibi patlamaz', async () => {
    const { provider: p } = provider(() => new Response('{"choices": [{"mess', { status: 200 }));
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

  it('token sınırında kesilen cevap tam metin gibi kaydedilmez', async () => {
    const { provider: p } = provider(() => jsonResponse(200, finishing('length')));
    const error = await providerError(p.generateText(request));
    expect(error.kind).toBe('invalid_output');
    expect(error.message).toContain('maxTokens');
  });

  it('içerik filtresi kesmesi safety_blocked olur, yeniden denenmez', async () => {
    const { provider: p } = provider(() => jsonResponse(200, finishing('content_filter')));
    expect(await providerError(p.generateText(request))).toMatchObject({
      kind: 'safety_blocked',
      retryable: false,
    });
  });

  it('sunucu kaynağı yetmeyen ya da yarıda kesilen cevap geçici sunucu hatası sayılır', async () => {
    for (const reason of ['insufficient_system_resource', 'aborted']) {
      const { provider: p } = provider(() => jsonResponse(200, finishing(reason)));
      expect(await providerError(p.generateText(request)), reason).toMatchObject({
        kind: 'server_error',
        retryable: true,
      });
    }
  });

  it('seçenek yoksa ya da metin boş/boşluksa empty_output olur (T10)', async () => {
    const empties = [
      reply('x', { choices: [] }),
      reply('x', { choices: undefined }),
      reply(null),
      reply(''),
      reply('  \n '),
    ];
    for (const body of empties) {
      const { provider: p } = provider(() => jsonResponse(200, body));
      expect((await providerError(p.generateText(request))).kind).toBe('empty_output');
    }
  });

  it('kullanım bilgisi yoksa token sayıları 0 olur, uydurulmaz', async () => {
    const { provider: p } = provider(() => jsonResponse(200, reply('metin', { usage: undefined })));
    expect(await p.generateText(request)).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('DeepSeek adaptörü: yapılandırılmış (JSON) cevap', () => {
  const schema = z.object({ puan: z.number().min(1).max(5), gerekce: z.string() });
  const jsonRequest = { ...request, schema };
  const answer = (value: string) => jsonResponse(200, reply(value));

  it('şemaya uyan cevabı tipli veri olarak döner; JSON kipi açılır, şema komuta yazılır', async () => {
    const { provider: p, calls } = provider(() => answer('{"puan": 4, "gerekce": "iyi imgeler"}'));
    const result = await p.generateJson(jsonRequest);
    expect(result.data).toEqual({ puan: 4, gerekce: 'iyi imgeler' });

    const body = calls[0]?.body as {
      response_format: unknown;
      thinking: unknown;
      messages: { role: string; content: string }[];
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    // DeepSeek şemayı zorlamaz; "JSON" sözcüğü ve şema komutta olmazsa boş cevap verebilir.
    const system = body.messages[0]!;
    expect(system.role).toBe('system');
    expect(system.content).toContain('JSON');
    expect(system.content).toContain('"puan"');
    expect(system.content).toContain('"gerekce"');
    expect(system.content).not.toContain('$schema');
    expect(body.messages[1]).toEqual({ role: 'user', content: request.prompt });
  });

  it('puanlamada sıcaklık verilmezse 0 gönderilir; verilirse o kullanılır', async () => {
    const ok = '{"puan": 4, "gerekce": "x"}';
    const first = provider(() => answer(ok));
    await first.provider.generateJson(jsonRequest);
    expect((first.calls[0]?.body as { temperature: number }).temperature).toBe(0);

    const second = provider(() => answer(ok));
    await second.provider.generateJson({ ...jsonRequest, temperature: 0.5 });
    expect((second.calls[0]?.body as { temperature: number }).temperature).toBe(0.5);
  });

  it('verilen sistem komutu şema yönergesinin yanında korunur', async () => {
    const { provider: p, calls } = provider(() => answer('{"puan": 4, "gerekce": "x"}'));
    await p.generateJson({ ...jsonRequest, system: 'Sen bir hakemsin.', maxTokens: 900 });
    const body = calls[0]?.body as { messages: { content: string }[]; max_tokens: number };
    expect(body.messages[0]?.content).toContain('Sen bir hakemsin.');
    expect(body.messages[0]?.content).toContain('JSON');
    expect(body.max_tokens).toBe(900);
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

  it('JSON kipinde boş içerik empty_output olur (belge: JSON olmayan istekte içerik boş gelebilir)', async () => {
    const { provider: p } = provider(() => answer(''));
    expect((await providerError(p.generateJson(jsonRequest))).kind).toBe('empty_output');
  });
});

describe('DeepSeek adaptörü + koruyucu kılıf', () => {
  it('503 sonrası bekleyip yeniden dener ve başarır (T08)', async () => {
    let n = 0;
    const { provider: p, calls } = provider(() =>
      n++ === 0 ? jsonResponse(503, apiError()) : jsonResponse(200, reply()),
    );
    const sleeps: number[] = [];
    const safe = withResilience(p, { sleep: async (ms) => void sleeps.push(ms) });
    expect((await safe.generateText(request)).text).toBe('Yaprak yaprak döküldü gün.');
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('bakiye bitince (402) yeniden denenmez', async () => {
    const { provider: p, calls } = provider(() =>
      jsonResponse(402, apiError('Insufficient Balance')),
    );
    await providerError(withResilience(p, { sleep: async () => {} }).generateText(request));
    expect(calls).toHaveLength(1);
  });
});
