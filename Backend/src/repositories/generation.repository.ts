import type { Genre } from '../domain/rubric.js';

export interface StartGeneration {
  providerModelId: number;
  promptTemplateId: number;
  genre: Genre;
  theme: string;
  replicateNo: number;
  /** Üretimin yeniden kurulabilmesi için: doldurulan değişkenler, token ve süre sınırları, şablon sürümü. */
  params: Record<string, unknown>;
}

export interface GenerationSuccess {
  genre: Genre;
  theme: string;
  body: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Üretim kayıt defteri: her model çağrısı ve (başarılıysa) ürettiği metin. */
export interface GenerationRepository {
  /** Çağrı başlamadan kaydı açar (durum: running) ve kimliğini döner. */
  start(input: StartGeneration): Promise<number>;
  /** Tek işlemde: kaydı başarılı yapar ve metni kaydeder. Metnin kimliğini döner. */
  succeed(id: number, result: GenerationSuccess): Promise<number>;
  /** Kaydı başarısız yapar ve nedenini yazar. Metin kaydedilmez, sahte cevap üretilmez (ADR 0004). */
  fail(id: number, failure: { error: string; latencyMs: number }): Promise<void>;
}
