import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENRES, rubricInputSchema } from '../src/domain/rubric.js';

const dir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../prisma/seed-data/rubrics/v0.1-taslak',
);

describe('taslak rubrik v0.1 (seed verisi)', () => {
  for (const genre of GENRES) {
    describe(genre, () => {
      const json: unknown = JSON.parse(readFileSync(resolve(dir, `${genre}.json`), 'utf8'));
      const parsed = rubricInputSchema.safeParse(json);

      it('rubrik şemasına uyuyor', () => {
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
      });

      it('türü dosya adıyla aynı ve sürümü 0.1-taslak', () => {
        expect(parsed.data?.genre).toBe(genre);
        expect(parsed.data?.version).toBe('0.1-taslak');
      });

      it('geçici taslak uyarısı kaynak notunda yazılı (bilimsel dürüstlük)', () => {
        expect(parsed.data?.sourceNote).toContain('GEÇİCİ TASLAK');
        expect(parsed.data?.sourceNote).toContain('uzman doğrulaması yok');
      });

      it('4-5 kriter ve eşit ağırlık içeriyor', () => {
        const criteria = parsed.data?.criteria ?? [];
        expect(criteria.length).toBeGreaterThanOrEqual(4);
        expect(criteria.length).toBeLessThanOrEqual(5);
        expect(new Set(criteria.map((c) => c.weight)).size).toBe(1);
      });
    });
  }
});
