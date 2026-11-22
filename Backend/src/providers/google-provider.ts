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

export interface GoogleProviderOptions {
  apiKey: string;
  /** Testlerde sahte HTTP vermek için. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini generateContent cevabının bu adaptörün kullandığı kısmı. */
interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/** Güvenlik filtresinin cevabı kestiğini gösteren bitiş nedenleri. */
const BLOCKED_FINISH_REASONS: ReadonlySet<string> = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
]);

/** Gemini adaptörü. Hazır kütüphane yerine tek uç nokta için doğrudan HTTP kullanır (bağımlılık eklememek için). */
export class GoogleProvider implements LLMProvider {
  readonly id = 'google';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor({
    apiKey,
    fetch: fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
  }: GoogleProviderOptions) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async generateText(request: GenerateRequest): Promise<GenerateResult> {
    return this.post(request, {});
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete jsonSchema.$schema; // API bu anahtarı kabul etmez
    const { text, ...usage } = await this.post(request, {
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
    });
    return { data: parseStructured(text, request.schema), ...usage };
  }

  private async post(
    request: GenerateRequest,
    extraConfig: Record<string, unknown>,
  ): Promise<{ text: string } & Usage> {
    const started = Date.now();
    // Sıcaklık yalnızca verilirse gönderilir: yeni Gemini modelleri onu yok sayıyor ya da reddediyor.
    const generationConfig = {
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.maxTokens !== undefined && { maxOutputTokens: request.maxTokens }),
      ...extraConfig,
    };
    const body = {
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      ...(request.system !== undefined && {
        systemInstruction: { parts: [{ text: request.system }] },
      }),
      ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`,
        {
          method: 'POST',
          // Anahtar adrese değil başlığa yazılır: adresler günlüklere ve hata mesajlarına girebilir.
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );
    } catch (error) {
      throw networkError(error);
    }
    if (!response.ok) throw await httpError(response);

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    if (!candidate && data.promptFeedback?.blockReason) {
      throw new ProviderError(
        'safety_blocked',
        `İstek güvenlik nedeniyle engellendi (${data.promptFeedback.blockReason})`,
      );
    }
    if (candidate?.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
      throw new ProviderError(
        'safety_blocked',
        `Cevap güvenlik nedeniyle kesildi (${candidate.finishReason})`,
      );
    }
    // Düşünme tokenleri de sınıra dahildir: düşük sınır cevabı boş ya da yarım bırakabilir.
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new ProviderError(
        'invalid_output',
        'Cevap maxTokens sınırında kesildi; sınırı artırın',
      );
    }

    const text = (candidate?.content?.parts ?? [])
      .flatMap((part) => (!part.thought && typeof part.text === 'string' ? [part.text] : []))
      .join('');
    const usage = data.usageMetadata;
    return {
      text: requireText(text),
      inputTokens: usage?.promptTokenCount ?? 0,
      // Düşünme tokenleri çıktı olarak ücretlendirilir.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      latencyMs: Date.now() - started,
    };
  }
}
