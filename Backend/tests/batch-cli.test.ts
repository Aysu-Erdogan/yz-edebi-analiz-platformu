import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  parseBatchArgs,
  parseIdSelection,
  parseTopics,
} from '../src/services/batch-cli.js';

describe('toplu komut: argüman ayrıştırma', () => {
  it('komutu ve seçenekleri ayırır; değersiz seçenekler (bayrak) true olur', () => {
    expect(
      parseBatchArgs([
        'uret',
        '--konular',
        'siir:Sonbahar',
        '--modeller',
        'a,b',
        '--tekrar',
        '3',
        '--calistir',
      ]),
    ).toEqual({
      command: 'uret',
      options: { konular: 'siir:Sonbahar', modeller: 'a,b', tekrar: '3', calistir: true },
    });
    expect(parseBatchArgs(['durum'])).toEqual({ command: 'durum', options: {} });
    expect(parseBatchArgs(['puanla', '--kendini-disla']).options).toEqual({
      'kendini-disla': true,
    });
  });

  it('bilinmeyen komutu, bilinmeyen seçeneği ve eksik değeri açıkça reddeder', () => {
    expect(() => parseBatchArgs([])).toThrow(/komut/i);
    expect(() => parseBatchArgs(['bilinmeyen'])).toThrow(/bilinmeyen komut/i);
    expect(() => parseBatchArgs(['uret', '--yazimhatasi', '1'])).toThrow(/bilinmeyen seçenek/i);
    expect(() => parseBatchArgs(['uret', '--konular'])).toThrow(/değer/i);
    expect(() => parseBatchArgs(['uret', 'serbest'])).toThrow(/beklenmeyen/i);
  });
});

describe('toplu komut: konu ve metin seçimi', () => {
  it('konuları "tür:tema" çiftleri olarak okur; tema ilk iki noktadan sonrasıdır', () => {
    expect(parseTopics('siir:Sonbahar, hikaye:Deniz kıyısı')).toEqual([
      { genre: 'siir', theme: 'Sonbahar' },
      { genre: 'hikaye', theme: 'Deniz kıyısı' },
    ]);
    expect(parseTopics('deneme:Aşk: bir tanım')).toEqual([
      { genre: 'deneme', theme: 'Aşk: bir tanım' },
    ]);
  });

  it('geçersiz konuyu reddeder: bilinmeyen tür, boş tema, iki nokta yok', () => {
    for (const bad of ['', 'roman:Aşk', 'siir:', 'siir', ':Aşk', 'şiir:Aşk']) {
      expect(() => parseTopics(bad), bad).toThrow();
    }
  });

  it('metin seçimini okur: hepsi, tek kimlik, liste ve aralık', () => {
    expect(parseIdSelection('hepsi')).toEqual({ all: true });
    expect(parseIdSelection('5')).toEqual({ ids: [5] });
    expect(parseIdSelection('1-3,7')).toEqual({ ids: [1, 2, 3, 7] });
    expect(parseIdSelection('3, 3,2')).toEqual({ ids: [3, 2] }); // tekrarlar atılır
  });

  it('geçersiz seçimi reddeder', () => {
    for (const bad of ['', 'a', '0', '-1', '3-1', '1-', '1,,2', '1-100000']) {
      expect(() => parseIdSelection(bad), bad).toThrow();
    }
  });
});

describe('toplu komut: süre biçimi', () => {
  it('milisaniyeyi okunur süreye çevirir', () => {
    expect(formatDuration(0)).toBe('0 sn');
    expect(formatDuration(8_400)).toBe('8 sn');
    expect(formatDuration(73_000)).toBe('1 dk 13 sn');
    expect(formatDuration(5_400_000)).toBe('1 sa 30 dk');
    expect(formatDuration(3_600_000)).toBe('1 sa 0 dk');
  });
});
