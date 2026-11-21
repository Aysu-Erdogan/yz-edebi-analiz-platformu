import { z } from 'zod';
import type { Genre } from './rubric.js';

/** `{{ad}}` biçimindeki boşluklar. */
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

export function placeholdersOf(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1] as string))].sort();
}

/**
 * Şablonun boşluklarını doldurur. Eksik ya da şablonda olmayan fazla değer hata verir: yarım dolu bir
 * soru modele gitmesin, yazım hatası sessizce yok sayılmasın. Tek geçişte doldurulur, yani değerin
 * içindeki `{{...}}` yeniden genişletilmez.
 */
export function renderPrompt(body: string, vars: Record<string, string>): string {
  const needed = placeholdersOf(body);
  const missing = needed.filter((name) => !Object.hasOwn(vars, name));
  const extra = Object.keys(vars).filter((name) => !needed.includes(name));
  if (missing.length > 0) throw new Error(`Şablon için eksik değerler: ${missing.join(', ')}`);
  if (extra.length > 0) throw new Error(`Şablonda olmayan değerler: ${extra.join(', ')}`);
  return body.replace(PLACEHOLDER, (_match, name: string) => vars[name] as string);
}

/**
 * Tür adı ve uzunluk yönergesi (taslak: danışmanla kesinleşecek). Üretim kaydına dolu değerler yazıldığı
 * için bu tablo değişse bile eski üretimler yeniden kurulabilir.
 */
const GENRE_PROMPT: Record<Genre, { tur: string; uzunluk: string }> = {
  siir: { tur: 'şiir', uzunluk: '3-5 kıta' },
  hikaye: { tur: 'hikâye', uzunluk: 'yaklaşık 250-350 sözcük' },
  deneme: { tur: 'deneme', uzunluk: 'yaklaşık 250-350 sözcük' },
};

/**
 * Tek satır: tema soruya girer, çok satırlı metin sorunun yapısını bozabilir. En çok 32 karakter:
 * veritabanındaki tema alanları (texts.theme, generations.theme) bu kadar.
 */
const themeSchema = z
  .string()
  .trim()
  .min(1, 'Tema boş olamaz')
  .max(32, 'Tema en çok 32 karakter olabilir')
  .regex(/^[^\r\n]+$/, 'Tema tek satır olmalı');

/** Üretim şablonunun değişkenleri: tür, tema ve uzunluk. */
export function generationVars(genre: Genre, theme: string): Record<string, string> {
  return { ...GENRE_PROMPT[genre], tema: themeSchema.parse(theme) };
}

/** Üretim şablonunda bulunması zorunlu boşluklar (tema yok sayılan bir şablon olmaz). */
const REQUIRED_PLACEHOLDERS = ['tema', 'tur', 'uzunluk'];

export type PromptKind = 'generate' | 'judge';

/** Şablon kaydı girdisi. Yargıç şablonları F2'de eklenir. */
export const promptTemplateInputSchema = z
  .strictObject({
    kind: z.literal('generate'),
    version: z
      .string()
      .regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/, 'Sürüm 1-32 karakter olmalı; boşluk içermemeli'),
    body: z.string().trim().min(1, 'Şablon boş olamaz').max(5000),
  })
  .superRefine((template, ctx) => {
    const found = placeholdersOf(template.body);
    const missing = REQUIRED_PLACEHOLDERS.filter((name) => !found.includes(name));
    const unknown = found.filter((name) => !REQUIRED_PLACEHOLDERS.includes(name));
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `Zorunlu boşluklar eksik: ${missing.join(', ')}`,
      });
    }
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `Tanımsız boşluklar: ${unknown.join(', ')}`,
      });
    }
  });

export type PromptTemplateInput = z.infer<typeof promptTemplateInputSchema>;
