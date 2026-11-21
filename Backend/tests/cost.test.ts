import { describe, expect, it } from 'vitest';
import { estimateCostUsd, modelParamsSchema } from '../src/domain/model-params.js';

describe('model parametreleri', () => {
  it('geçerli parametreleri kabul eder, bilinmeyen anahtarları korur', () => {
    const parsed = modelParamsSchema.parse({
      maxTokens: 8192,
      timeoutMs: 120_000,
      priceUsdPerMillion: { input: 2, output: 10 },
      ilerideEklenen: true,
    });
    expect(parsed.maxTokens).toBe(8192);
    expect(parsed).toHaveProperty('ilerideEklenen', true);
  });

  it('boş parametre geçerlidir (hepsi isteğe bağlı)', () => {
    expect(modelParamsSchema.parse({})).toEqual({});
  });

  it('geçersiz sayıları reddeder', () => {
    for (const bad of [
      { maxTokens: 0 },
      { maxTokens: 1.5 },
      { timeoutMs: -1 },
      { priceUsdPerMillion: { input: -1, output: 1 } },
      { priceUsdPerMillion: { input: 1 } },
    ]) {
      expect(modelParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('maliyet tahmini', () => {
  it('girdi ve çıktı tokenini milyon başına fiyatla çarpar', () => {
    // 1000 girdi * $2/M + 8000 çıktı * $10/M = 0.002 + 0.08
    expect(estimateCostUsd(1000, 8000, { input: 2, output: 10 })).toBeCloseTo(0.082, 10);
  });

  it('ücretsiz (Mock) modelde sıfırdır', () => {
    expect(estimateCostUsd(5000, 5000, { input: 0, output: 0 })).toBe(0);
  });

  it('fiyat bilinmiyorsa tanımsız döner (sıfır sanılmasın)', () => {
    expect(estimateCostUsd(1000, 1000, undefined)).toBeUndefined();
  });
});
