import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { modelSeedSchema } from '../src/seed/model-seed.js';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/seed-data/models.json');
const models: unknown[] = JSON.parse(readFileSync(file, 'utf8'));

describe('model listesi (seed verisi)', () => {
  it('her kayıt şemaya uyar', () => {
    for (const model of models) {
      expect(modelSeedSchema.safeParse(model).error?.issues ?? []).toEqual([]);
    }
  });

  it('ADR 0010: orta sınıf iki model, Claude Sonnet 5.5 ve Gemini 3.8 Flash', () => {
    const ids = models
      .map((m) => modelSeedSchema.parse(m))
      .map((m) => `${m.provider}/${m.modelId}`);
    expect(ids.sort()).toEqual(['anthropic/claude-sonnet-5-5', 'google/gemini-3.8-flash']);
  });

  it('sağlayıcı ve model kimliği çifti tekrar etmez', () => {
    const keys = models
      .map((m) => modelSeedSchema.parse(m))
      .map((m) => `${m.provider}/${m.modelId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sıcaklık gibi desteklenmeyen parametre içermez (yeni modeller reddeder ya da yok sayar)', () => {
    for (const model of models) {
      expect(modelSeedSchema.parse(model).defaultParams ?? {}).not.toHaveProperty('temperature');
    }
  });

  it('geçersiz kayıtları reddeder', () => {
    const bad = [
      { provider: 'bilinmeyen', modelId: 'x', displayName: 'X' },
      { provider: 'google', modelId: '', displayName: 'X' },
      { provider: 'google', modelId: 'x', displayName: 'X', yazimHatasi: true },
    ];
    for (const entry of bad) expect(modelSeedSchema.safeParse(entry).success).toBe(false);
  });
});
