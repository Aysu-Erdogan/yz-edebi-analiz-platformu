import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { errorFromStatus } from './http-errors.js';
import {
  ProviderError,
  parseStructured,
  requireText,
  type GenerateRequest,
  type GenerateResult,
  type JsonRequest,
  type JsonResult,
  type LLMProvider,
} from './provider.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Testlerde sahte HTTP vermek için. */
  fetch?: typeof fetch;
  baseURL?: string;
}

/** Şiir, hikâye ve deneme için yeterli; üretim kısa. Çağrı başına `maxTokens` ile değiştirilir. */
const DEFAULT_MAX_TOKENS = 4096;

/** Anthropic kütüphanesinin hatalarını ortak sağlayıcı hatasına çevirir. */
function toProviderError(error: unknown): unknown {
  if (error instanceof ProviderError) return error;
  if (
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return new ProviderError('timeout', 'İstek süresinde tamamlanamadı', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('server_error', 'Sağlayıcıya bağlanılamadı', { cause: error });
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return errorFromStatus(error.status, error.apiMessage ?? error.message, error.headers);
  }
  return error; // beklenmeyen hata (kod hatası olabilir): olduğu gibi görünür kalır
}

/** Reddedilen ve yarıda kesilen cevaplar tam metin gibi kaydedilmez (ADR 0004). */
function assertComplete(message: Anthropic.Message): void {
  if (message.stop_reason === 'refusal') {
    throw new ProviderError('safety_blocked', 'Model güvenlik nedeniyle cevap vermedi');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ProviderError('invalid_output', 'Cevap maxTokens sınırında kesildi; sınırı artırın');
  }
}

/** Claude (Anthropic) adaptörü. Yeniden deneme dış katmanda (withResilience) yapılır, kütüphanenin kendi denemesi kapalı. */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  private readonly client: Anthropic;

  constructor({ apiKey, fetch: fetchImpl, baseURL }: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey,
      maxRetries: 0,
      ...(fetchImpl && { fetch: fetchImpl }),
      ...(baseURL && { baseURL }),
    });
  }

  async generateText(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    const answer = await this.send(this.params(request), request.signal);
    return { ...answer, latencyMs: Date.now() - started };
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const started = Date.now();
    // Cevabı kütüphanenin `parse` yardımcısına bırakmıyoruz: reddedilen/kesilen cevaplarda doğru
    // hata türünü bizim kontrolümüz vermeli. Şema yine API'ye gider, doğrulama bizde (Gemini ve Mock ile aynı).
    const { text, ...usage } = await this.send(
      { ...this.params(request), output_config: { format: zodOutputFormat(request.schema) } },
      request.signal,
    );
    return {
      data: parseStructured(text, request.schema),
      ...usage,
      latencyMs: Date.now() - started,
    };
  }

  /** Sıcaklık yalnızca verilirse gönderilir: yeni Claude modelleri varsayılan dışı değeri 400 ile reddeder. */
  private params(request: GenerateRequest): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: request.prompt }],
      ...(request.system !== undefined && { system: request.system }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
    };
  }

  private async send(
    params: Anthropic.MessageCreateParamsNonStreaming,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(params, { signal });
    } catch (error) {
      throw toProviderError(error);
    }
    assertComplete(message);
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    return {
      text: requireText(text),
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      latencyMs: 0, // çağıran gerçek süreyi ekler
    };
  }
}
