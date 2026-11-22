import type { Genre } from '../domain/rubric.js';

/** Puanlanacak metin: yalnızca hakemin görebileceği alanlar (metni üreten modelin bilgisi burada yok, kör değerlendirme). */
export interface EvaluableText {
  id: number;
  genre: Genre;
  theme: string;
  body: string;
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
}
