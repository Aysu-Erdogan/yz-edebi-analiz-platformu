import type { Genre } from '../domain/rubric.js';

export interface NewManualText {
  genre: Genre;
  theme: string;
  body: string;
  /** Metni yazan modelin etiketi (örn. ChatGPT); yazar bilgisi değil, kullanıcının verdiği addır. */
  label: string | null;
}

/** Elle girilen metinlerin kayıt defteri (üretilen metinler üretim kaydıyla birlikte yazılır). */
export interface TextRepository {
  /** Tek işlemde kaydeder (biri yazılamazsa hiçbiri kalmaz); kimlikleri girdi sırasıyla döner. */
  createManual(items: NewManualText[]): Promise<number[]>;
}
