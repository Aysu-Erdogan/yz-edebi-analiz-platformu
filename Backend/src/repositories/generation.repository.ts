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

/** Başarılı bir üretimin kimliği: toplu işte hangi öğenin bittiğini anlamak için. */
export interface SucceededGeneration {
  providerModelId: number;
  genre: Genre;
  theme: string;
  replicateNo: number;
}

/** Bir modelin geçmiş başarılı üretimlerinin ortalaması (toplu işin maliyet ve süre tahmini için). */
export interface ModelUsage {
  providerModelId: number;
  count: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgLatencyMs: number;
}

/** Üretim kayıt defteri: her model çağrısı ve (başarılıysa) ürettiği metin. */
export interface GenerationRepository {
  /** Çağrı başlamadan kaydı açar (durum: running) ve kimliğini döner. */
  start(input: StartGeneration): Promise<number>;
  /** Tek işlemde: kaydı başarılı yapar ve metni kaydeder. Metnin kimliğini döner. */
  succeed(id: number, result: GenerationSuccess): Promise<number>;
  /** Kaydı başarısız yapar ve nedenini yazar. Metin kaydedilmez, sahte cevap üretilmez (ADR 0004). */
  fail(id: number, failure: { error: string; latencyMs: number }): Promise<void>;
  /** Verilen şablonla ve modellerle başarıyla üretilmiş öğeler (toplu işin kaldığı yeri bulması için). */
  findSucceeded(filter: {
    promptTemplateId: number;
    providerModelIds: number[];
  }): Promise<SucceededGeneration[]>;
  /** Geçmiş başarılı üretimlerin model başına ortalaması; hiç geçmişi olmayan model listede yer almaz. */
  usageByModel(providerModelIds: number[]): Promise<ModelUsage[]>;
  /**
   * Yarım kalan ("çalışıyor") kayıtları başarısız yapar ve kaç tane olduğunu döner. Tek işçi varsayımıyla,
   * işçi açılırken çağrılır: o sırada "çalışıyor" görünen kayıt çökmüş bir sürecin artığıdır.
   */
  failInterrupted(error: string): Promise<number>;
}
