import type { Genre } from '../domain/rubric.js';

export type TextSource = 'generated' | 'manual';

export interface TextFilter {
  genre?: Genre;
  theme?: string;
  source?: TextSource;
}

/** Üretilen metnin yazarı (üretim kaydındaki model). Elle girilen metinde yoktur. */
export interface TextAuthor {
  provider: string;
  modelId: string;
  displayName: string;
}

export interface LibraryText {
  id: number;
  genre: Genre;
  theme: string;
  source: TextSource;
  /** Elle girilen metinde kullanıcının verdiği etiket (örn. ChatGPT). */
  label: string | null;
  author: TextAuthor | null;
  body: string;
  createdAt: Date;
  /** Başarıyla puanlanmış değerlendirme sayısı (tüm hakemler, tekrarlar dahil). */
  succeededEvaluations: number;
}

export interface LibraryEvaluation {
  id: number;
  /** Hakem, `sağlayıcı/model` biçiminde. */
  judge: string;
  rubricVersion: string;
  templateVersion: string | null;
  replicateNo: number;
  status: string;
  error: string | null;
  /** Ağırlıklı toplam, 0-100; başarısızsa boş. */
  totalScore: number | null;
  /** Rubrik sırasıyla; başarısız kayıtta boş. */
  scores: { key: string; label: string; score: number; comment: string | null }[];
  createdAt: Date;
}

export interface LibraryTextDetail extends LibraryText {
  /** Üretilen metinde üretim kaydı; elle girilende boş. */
  generation: {
    templateVersion: string;
    replicateNo: number;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
  } | null;
  evaluations: LibraryEvaluation[];
}

/** Metin kütüphanesi: yalnızca okur. */
export interface TextLibraryRepository {
  /** Süzgece uyan metinler, kimliğe göre artan sırada. */
  list(filter: TextFilter): Promise<LibraryText[]>;
  /** Metin, üretim kaydı ve tüm puanlamalarıyla; yoksa null. */
  get(id: number): Promise<LibraryTextDetail | null>;
}
