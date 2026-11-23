import type { Genre } from '../domain/rubric.js';

/** Puanlanacak metin: yalnızca hakemin görebileceği alanlar (metni üreten modelin bilgisi burada yok, kör değerlendirme). */
export interface EvaluableText {
  id: number;
  genre: Genre;
  theme: string;
  body: string;
}

/** Başarıyla puanlanmış bir öğenin kimliği: toplu işin kaldığı yeri bulması için. */
export interface SucceededEvaluation {
  textId: number;
  evaluatorRef: string;
  replicateNo: number;
}

/** Bir hakemin geçmiş başarılı puanlamalarından bir örnek (toplu işin maliyet ve süre tahmini için). */
export interface EvaluationUsage {
  evaluatorRef: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Üretilmiş metnin yazarı (üretim kaydından): çapraz yargıç ve kendi-puanı analizi için. Hakeme verilmez. */
export interface TextAuthor {
  textId: number;
  provider: string;
  modelId: string;
}

export interface StartEvaluation {
  textId: number;
  rubricId: number;
  promptTemplateId: number;
  /** Hakem model, `sağlayıcı/model` biçiminde (örn. `anthropic/claude-sonnet-5-5`). */
  evaluatorRef: string;
  replicateNo: number;
}

export interface EvaluationSuccess {
  /** Ağırlıklı toplam, 0-100. */
  totalScore: number;
  /** Rubrik sırasıyla: ham puan ve gerekçe. */
  scores: { key: string; score: number; comment: string }[];
  /** Doğrulanmış ham cevap, deneme sayısı, token ve süre, komut ve rubrik sürümü (tekrarlanabilirlik). */
  rawResponse: Record<string, unknown>;
}

/**
 * Hakem puanı kayıt defteri. Her hakem çağrısı bir `evaluation` kaydıdır; başarılıysa kriter puanları da yazılır.
 * İnsan puanı bu arayüzde yok: etik kurul onayına kadar kapalı.
 */
export interface EvaluationRepository {
  findText(id: number): Promise<EvaluableText | null>;
  /** Hakem çağrısı başlamadan kaydı açar (durum: running) ve kimliğini döner. */
  start(input: StartEvaluation): Promise<number>;
  /** Tek işlemde: kaydı başarılı yapar, toplamı ve kriter puanlarını yazar. */
  succeed(id: number, result: EvaluationSuccess): Promise<void>;
  /** Kaydı başarısız yapar ve nedenini yazar. Puan satırı yazılmaz, uydurma puan yok (ADR 0004). */
  fail(
    id: number,
    failure: { error: string; rawResponse?: Record<string, unknown> },
  ): Promise<void>;
  /** Verilen metinleri döner; olmayan kimlikler listede yer almaz. */
  findTexts(ids: number[]): Promise<EvaluableText[]>;
  /** Üretilmiş metinlerin yazarı (elle girilen metinlerin yazarı yoktur, listede yer almaz). */
  findAuthors(textIds: number[]): Promise<TextAuthor[]>;
  /** Tüm metinlerin kimliği (artan sırada); `genre` verilirse yalnızca o türün metinleri. */
  listTextIds(genre?: EvaluableText['genre']): Promise<number[]>;
  /** Hakem başına en çok `perEvaluator` son başarılı puanlamanın token ve süre bilgisi (hakemin `rawResponse.usage`'ı). */
  recentUsage(evaluatorRefs: string[], perEvaluator: number): Promise<EvaluationUsage[]>;
  /** Verilen komut, rubrik ve metinlerle başarıyla puanlanmış öğeler (toplu işin kaldığı yeri bulması için). */
  findSucceeded(filter: {
    promptTemplateId: number;
    rubricIds: number[];
    textIds: number[];
  }): Promise<SucceededEvaluation[]>;
  /**
   * Yarım kalan ("çalışıyor") kayıtları başarısız yapar, kaç tane olduğunu döner. Tek işçi varsayımıyla işçi
   * açılırken çağrılır: o sırada "çalışıyor" görünen kayıt çökmüş bir sürecin artığıdır.
   */
  failInterrupted(error: string): Promise<number>;
}
