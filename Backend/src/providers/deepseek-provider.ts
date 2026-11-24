import { z } from 'zod';
import { httpError, networkError } from './http-errors.js';
import {
  ProviderError,
  parseStructured,
  requireText,
  type GenerateRequest,
  type GenerateResult,
  type JsonRequest,
  type JsonResult,
  type LLMProvider,
  type Usage,
} from './provider.js';

export interface DeepSeekProviderOptions {
  apiKey: string;
  /** Testlerde sahte HTTP vermek için. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** Chat Completions cevabının bu adaptörün kullandığı kısmı. */
interface ChatReply {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * DeepSeek adaptörü (Chat Completions, OpenAI uyumlu biçim; belge: api-docs.deepseek.com, 23 Kas 2026).
 *
 * shortcut: düşünme (thinking) her zaman kapalı gönderilir, ayar yok. Kapalıyken sıcaklık işe yarar ve
 * düşünme tokenlerinin faturaya nasıl girdiği (belgede belirsiz) konusu doğmaz. Açık denemek gerekirse
 * `thinking` ve `reasoning_content` için seçenek eklenir.
 */
export class DeepSeekProvider implements LLMProvider {
  readonly id = 'deepseek';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor({
    apiKey,
    fetch: fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
  }: DeepSeekProviderOptions) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async generateText(request: GenerateRequest): Promise<GenerateResult> {
    return this.post(request);
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const schema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete schema.$schema;
    // DeepSeek yalnızca "json_object" kipini bilir, şemayı zorlamaz: şema komuta yazılır, cevap yine
    // `parseStructured` ile doğrulanır. Komutta "JSON" geçmezse belge boş cevap verebileceğini söyler.
    const instruction = `Cevabı yalnızca tek bir JSON nesnesi olarak ver, başka metin yazma. JSON şu şemaya uymalı:\n${JSON.stringify(schema)}`;
    const { text, ...usage } = await this.post(
      {
        ...request,
        system: request.system === undefined ? instruction : `${request.system}\n\n${instruction}`,
        // Puanlama yolu: sıcaklık verilmezse 0 (varsayılan 1, aynı metne her seferinde başka puan verdirir).
        temperature: request.temperature ?? 0,
      },
      { type: 'json_object' },
    );
    return { data: parseStructured(text, request.schema), ...usage };
  }

  private async post(
    request: GenerateRequest,
    format?: Record<string, unknown>,
  ): Promise<{ text: string } & Usage> {
    const started = Date.now();
    const body = {
      model: request.model,
      messages: [
        ...(request.system !== undefined ? [{ role: 'system', content: request.system }] : []),
        { role: 'user', content: request.prompt },
      ],
      thinking: { type: 'disabled' },
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      ...(format && { response_format: format }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        // Anahtar adrese değil başlığa yazılır: adresler günlüklere ve hata mesajlarına girebilir.
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      throw networkError(error);
    }
    if (!response.ok) throw await httpError(response);

    // Yavaş cevapta DeepSeek bağlantıyı boş satırlarla açık tutar (JSON ayrıştırması bunları atlar);
    // bu beklemede bağlantı gövde okunurken de kopabilir.
    let data: ChatReply;
    try {
      data = (await response.json()) as ChatReply;
    } catch (cause) {
      throw networkError(cause);
    }

    const choice = data.choices?.[0];
    switch (choice?.finish_reason) {
      case 'content_filter':
        throw new ProviderError('safety_blocked', 'Cevap içerik filtresi nedeniyle kesildi');
      case 'length':
        throw new ProviderError(
          'invalid_output',
          'Cevap maxTokens sınırında kesildi; sınırı artırın',
        );
      case 'insufficient_system_resource':
      case 'aborted':
        throw new ProviderError(
          'server_error',
          `Cevap tamamlanamadı (${choice.finish_reason}): sunucu yetersiz ya da isteği yarıda kesti`,
        );
    }

    return {
      text: requireText(choice?.message?.content),
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}
