import { z } from 'zod';

/** Edebi türler. Veritabanındaki `Genre` ve OpenAPI'deki değerlerle birebir aynıdır (ASCII). */
export const GENRES = ['siir', 'hikaye', 'deneme'] as const;
export type Genre = (typeof GENRES)[number];

/** Rubrik durumu: taslak → etkin → arşivli. Veritabanındaki `RubricStatus` ile aynıdır. */
export const RUBRIC_STATUSES = ['draft', 'active', 'archived'] as const;
export type RubricStatus = (typeof RUBRIC_STATUSES)[number];

/** Ağırlıklar ondalık yuvarlama farkıyla (0.1 + 0.2 + 0.7) 1'e eşit sayılır. */
const WEIGHT_SUM_TOLERANCE = 1e-6;

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;

const levelSchema = z.strictObject({
  score: z.number().int('Düzey puanı tam sayı olmalı'),
  descriptor: z.string().trim().min(1, 'Düzey açıklaması boş olamaz').max(1000),
});

const criterionSchema = z.strictObject({
  key: z
    .string()
    .max(64)
    .regex(KEY_PATTERN, 'Anahtar harfle başlamalı, yalnızca ASCII harf ve rakam içermeli'),
  label: z.string().trim().min(1, 'Kriter adı boş olamaz').max(128),
  description: z.string().trim().min(1, 'Kriter açıklaması boş olamaz').max(2000),
  weight: z.number('Ağırlık sayı olmalı').positive('Ağırlık sıfırdan büyük olmalı'),
  levels: z.array(levelSchema).min(2, 'En az iki düzey (en düşük ve en yüksek) tanımlanmalı'),
});

/**
 * Rubrik girdisi (içe aktarma JSON'u). Rubrik kod değil veridir (ADR 0003): gerçek rubrik geldiğinde
 * yalnızca bu biçime uyan yeni bir JSON içe aktarılır. Durum (taslak/etkin) girdiden değil sistemden gelir.
 */
export const rubricInputSchema = z
  .strictObject({
    genre: z.enum(GENRES, { error: 'Tür siir, hikaye ya da deneme olmalı (Türkçe karakter yok)' }),
    version: z
      .string()
      .regex(
        VERSION_PATTERN,
        'Sürüm 1-32 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi içerebilir',
      ),
    sourceNote: z.string().trim().max(1000).optional(),
    scale: z.strictObject({
      min: z.number().int('Ölçek değeri tam sayı olmalı'),
      max: z.number().int('Ölçek değeri tam sayı olmalı'),
    }),
    criteria: z.array(criterionSchema).min(1, 'En az bir kriter gerekli').max(12),
  })
  .superRefine((rubric, ctx) => {
    const { min, max } = rubric.scale;
    const scaleOk = min < max;
    if (!scaleOk) {
      ctx.addIssue({
        code: 'custom',
        path: ['scale', 'max'],
        message: `Ölçeğin en büyük değeri en küçüğünden büyük olmalı (${min}–${max})`,
      });
    }

    const sum = rubric.criteria.reduce((total, c) => total + c.weight, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: 'custom',
        path: ['criteria'],
        message: `Ağırlıkların toplamı 1 olmalı (şu an ${Number(sum.toFixed(6))})`,
      });
    }

    const seenKeys = new Set<string>();
    rubric.criteria.forEach((criterion, i) => {
      if (seenKeys.has(criterion.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['criteria', i, 'key'],
          message: `Kriter anahtarı tekrar ediyor: ${criterion.key}`,
        });
      }
      seenKeys.add(criterion.key);

      if (!scaleOk) return; // Ölçek bozukken düzey kontrolü anlamsız ve gürültü olur.

      const seenScores = new Set<number>();
      criterion.levels.forEach((level, j) => {
        if (level.score < min || level.score > max) {
          ctx.addIssue({
            code: 'custom',
            path: ['criteria', i, 'levels', j, 'score'],
            message: `Düzey puanı ${min}–${max} aralığında olmalı (gelen: ${level.score})`,
          });
        }
        if (seenScores.has(level.score)) {
          ctx.addIssue({
            code: 'custom',
            path: ['criteria', i, 'levels', j, 'score'],
            message: `Düzey puanı tekrar ediyor: ${level.score}`,
          });
        }
        seenScores.add(level.score);
      });

      // Çapa düzeyleri: en düşük ve en yüksek puanın ne demek olduğu yazılı olmalı (tutarlı puanlama için).
      if (!seenScores.has(min) || !seenScores.has(max)) {
        ctx.addIssue({
          code: 'custom',
          path: ['criteria', i, 'levels'],
          message: `Ölçeğin en düşük (${min}) ve en yüksek (${max}) düzeyi tanımlanmalı`,
        });
      }
    });
  });

export type RubricInput = z.infer<typeof rubricInputSchema>;
