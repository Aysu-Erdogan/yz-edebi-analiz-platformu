import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { modelParamsSchema } from '../src/domain/model-params.js';
import { modelSeedSchema } from '../src/seed/model-seed.js';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/seed-data/models.json');
const models: unknown[] = JSON.parse(readFileSync(file, 'utf8'));

describe('model listesi (seed verisi)', () => {
  it('her modelin ayarları geçerli; üretim için süre sınırı ve maliyet tahmini fiyatı var (ADR 0010)', () => {
    for (const model of models) {
      const { defaultParams = {} } = modelSeedSchema.parse(model);
      const params = modelParamsSchema.parse(defaultParams);
      expect(params.maxTokens).toBeGreaterThan(0);
      expect(params.timeoutMs).toBeGreaterThanOrEqual(120_000); // düşünen modeller yavaş
      expect(params.priceUsdPerMillion).toBeDefined();
    }
  });

  it('her kayıt şemaya uyar', () => {
    for (const model of models) {
      expect(modelSeedSchema.safeParse(model).error?.issues ?? []).toEqual([]);
    }
  });

  it('ADR 0010: orta sınıf üç model, Claude Sonnet 5.5, Gemini 4 Hydrogen ve GPT-6.2 Sol', () => {
    const ids = models
      .map((m) => modelSeedSchema.parse(m))
      .map((m) => `${m.provider}/${m.modelId}`);
    expect(ids.sort()).toEqual([
      'anthropic/claude-sonnet-5-5',
      'google/gemini-4-hydrogen',
      'openai/gpt-6.2-sol',
    ]);
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
