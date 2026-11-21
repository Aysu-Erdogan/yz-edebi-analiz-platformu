import {
  estimateTokens,
  parseStructured,
  requireText,
  type GenerateRequest,
  type GenerateResult,
  type JsonRequest,
  type JsonResult,
  type LLMProvider,
} from './provider.js';

export interface MockProviderOptions {
  /** Cevabı belirler (testlerde hata ve boş cevap üretmek için). Verilmezse isteğe bağlı sabit bir metin döner. */
  respond?: (request: GenerateRequest) => string | Promise<string>;
}

/** Gerçek API'ye gitmeyen sağlayıcı: testlerde ve geliştirmede para harcamadan tüm akışı dener. */
export class MockProvider implements LLMProvider {
  readonly id = 'mock';
  /** Aldığı istekler, sırayla. */
  readonly calls: GenerateRequest[] = [];

  constructor(private readonly options: MockProviderOptions = {}) {}

  async generateText(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();
    const text = await this.answer(request);
    return {
      text,
      inputTokens: estimateTokens(request.prompt),
      outputTokens: estimateTokens(text),
      latencyMs: Date.now() - started,
    };
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    const started = Date.now();
    const text = await this.answer(request);
    return {
      data: parseStructured(text, request.schema),
      inputTokens: estimateTokens(request.prompt),
      outputTokens: estimateTokens(text),
      latencyMs: Date.now() - started,
    };
  }

  private async answer(request: GenerateRequest): Promise<string> {
    this.calls.push(request);
    const respond =
      this.options.respond ?? ((r: GenerateRequest) => `[Mock] ${r.prompt.slice(0, 80)}`);
    return requireText(await respond(request));
  }
}
