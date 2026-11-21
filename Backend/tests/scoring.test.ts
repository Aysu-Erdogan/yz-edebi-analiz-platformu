import { describe, expect, it } from 'vitest';
import { normalizeScore } from '../src/domain/scoring.js';

describe('puan normalleştirme: aralık tabanlı (min-max), 0–100 (T06)', () => {
  const scale15 = { min: 1, max: 5 };

  it('T06: 1–5 ölçeğinde en düşük 0, en yüksek 100, orta 50 olur', () => {
    expect(normalizeScore(1, scale15)).toBe(0);
    expect(normalizeScore(3, scale15)).toBe(50);
    expect(normalizeScore(5, scale15)).toBe(100);
  });

  it('T06: ara değerler eşit aralıklıdır (2 → 25, 4 → 75)', () => {
    expect(normalizeScore(2, scale15)).toBe(25);
    expect(normalizeScore(4, scale15)).toBe(75);
  });

  it('ondalıklı puan (ağırlıklı ortalama) da normalleşir', () => {
    expect(normalizeScore(4.2, scale15)).toBeCloseTo(80, 10);
  });

  it('başka ölçeklerde de çalışır (1–4, 0–10)', () => {
    expect(normalizeScore(4, { min: 1, max: 4 })).toBe(100);
    expect(normalizeScore(2.5, { min: 1, max: 4 })).toBe(50);
    expect(normalizeScore(7, { min: 0, max: 10 })).toBe(70);
  });

  it('ölçeğin dışındaki puan sessizce kırpılmaz, hata fırlatır', () => {
    expect(() => normalizeScore(0, scale15)).toThrow(RangeError);
    expect(() => normalizeScore(5.01, scale15)).toThrow(RangeError);
  });

  it('sayı olmayan puan (NaN, sonsuz) hata fırlatır', () => {
    expect(() => normalizeScore(Number.NaN, scale15)).toThrow(RangeError);
    expect(() => normalizeScore(Number.POSITIVE_INFINITY, scale15)).toThrow(RangeError);
  });

  it('geçersiz ölçek (en küçük >= en büyük) sıfıra bölmeye izin vermez', () => {
    expect(() => normalizeScore(1, { min: 3, max: 3 })).toThrow(RangeError);
    expect(() => normalizeScore(1, { min: 5, max: 1 })).toThrow(RangeError);
  });
});
