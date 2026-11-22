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

export interface OpenAIProviderOptions {
  apiKey: string;
  /** Testlerde sahte HTTP vermek için. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Responses API cevabının bu adaptörün kullandığı kısmı. */
interface ResponsesReply {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** OpenAI adaptörü (Responses API). Hazır kütüphane yerine tek uç nokta için doğrudan HTTP kullanır (bağımlılık eklememek için). */
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor({
    apiKey,
    fetch: fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
  }: OpenAIProviderOptions) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async generateText(request: GenerateRequest): Promise<GenerateResult> {
    return this.post(request);
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const schema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete schema.$schema; // kip için gereksiz anahtar
    const { text, ...usage } = await this.post(request, {
      type: 'json_schema',
      name: 'sonuc',
      strict: true,
      schema,
    });
    return { data: parseStructured(text, request.schema), ...usage };
  }

  private async post(
    request: GenerateRequest,
    format?: Record<string, unknown>,
  ): Promise<{ text: string } & Usage> {
    const started = Date.now();
    // Sıcaklık yalnızca verilirse gönderilir: düşünen modeller onu reddedebilir ya da yok sayabilir.
    const body = {
      model: request.model,
      input: request.prompt,
      store: false, // üretilen metinler OpenAI tarafında saklanmasın
      ...(request.system !== undefined && { instructions: request.system }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      // Düşünme tokenleri de bu sınıra dahildir: düşük sınır cevabı boş ya da yarım bırakabilir.
      ...(request.maxTokens !== undefined && { max_output_tokens: request.maxTokens }),
      ...(format && { text: { format } }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
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

    const data = (await response.json()) as ResponsesReply;
    if (data.status === 'incomplete') {
      const reason = data.incomplete_details?.reason;
      if (reason === 'content_filter') {
        throw new ProviderError('safety_blocked', 'Cevap içerik filtresi nedeniyle kesildi');
      }
      throw new ProviderError(
        'invalid_output',
        reason === 'max_output_tokens'
          ? 'Cevap maxTokens sınırında kesildi; sınırı artırın'
          : `Cevap yarım kaldı (${reason ?? 'neden belirtilmedi'})`,
      );
    }
    if (data.status && data.status !== 'completed') {
      // shortcut: failed ve diğer durumlar geçici sayılır; kalıcı bir hata en çok 3 denemeyle sınırlıdır, durumlar gerçek kullanımda görülünce ayrıştırılır.
      throw new ProviderError(
        'server_error',
        `Cevap tamamlanamadı (${data.status}${data.error?.message ? `: ${data.error.message}` : ''})`,
      );
    }

    const parts = (data.output ?? [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? []);
    // Ret metni modelin açıklamasıdır; hataya taşınmaz.
    if (parts.some((part) => part.type === 'refusal')) {
      throw new ProviderError('safety_blocked', 'Model isteği reddetti');
    }
    const text = parts
      .flatMap((part) =>
        part.type === 'output_text' && typeof part.text === 'string' ? [part.text] : [],
      )
      .join('');
    return {
      text: requireText(text),
      inputTokens: data.usage?.input_tokens ?? 0,
      // output_tokens düşünme tokenlerini zaten içerir (ücretlendirilen de budur).
      outputTokens: data.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}
