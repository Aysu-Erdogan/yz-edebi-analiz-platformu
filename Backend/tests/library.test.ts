import { describe, expect, it } from 'vitest';
import { excerpt, wordCount } from '../src/domain/library.js';

describe('wordCount', () => {
  it('boşluk ve satır sonlarına göre sözcük sayar', () => {
    expect(wordCount('Yaprak düşer\nrüzgâr eser')).toBe(4);
    expect(wordCount('bir  iki\t\tüç\n\n\ndört')).toBe(4);
  });

  it('baştaki, sondaki ve fazla boşlukları saymaz; boş metin 0 sözcüktür', () => {
    expect(wordCount('  tek  ')).toBe(1);
    expect(wordCount('')).toBe(0);
    expect(wordCount(' \n\t ')).toBe(0);
  });
});

describe('excerpt', () => {
  it('kısa metni olduğu gibi (satır sonları boşluğa çevrilerek) verir, "…" eklemez', () => {
    expect(excerpt('Yaprak düşer,\nrüzgâr eser.')).toBe('Yaprak düşer, rüzgâr eser.');
  });

  it('uzun metni sınırda keser ve "…" ekler', () => {
    const result = excerpt('a'.repeat(200), 160);
    expect([...result]).toHaveLength(161);
    expect(result.endsWith('…')).toBe(true);
  });

  it('tam sınırdaki metni kesmez', () => {
    expect(excerpt('a'.repeat(160), 160)).toBe('a'.repeat(160));
    expect(excerpt('a'.repeat(161), 160)).toBe(`${'a'.repeat(160)}…`);
  });

  it('kesilen yerdeki boşluğu atar (sözcük sonunda boşluklu "…" olmaz)', () => {
    expect(excerpt('bir iki üç dört', 8)).toBe('bir iki…');
  });

  it('Türkçe karakterleri ve emoji gibi çift kodlu karakterleri ortasından bölmez', () => {
    expect(excerpt('çğıöşü'.repeat(40), 10)).toBe(`${'çğıöşü'.repeat(2).slice(0, 10)}…`);
    const result = excerpt('😀'.repeat(20), 5);
    expect(result).toBe(`${'😀'.repeat(5)}…`);
  });

  it('boş metin için boş dize verir', () => {
    expect(excerpt('  \n ')).toBe('');
  });
});
