import { describe, expect, it } from 'vitest';
import { bestIndexes, buildRequest, rawScore, weightPercents } from './data';
import { failedItem, succeededItem } from '../../test/compare-fixture';

describe('buildRequest', () => {
  it('boş alanları atlar, metni ve etiketi kırpar', () => {
    const request = buildRequest('siir', 'Doğa', [
      { label: ' ChatGPT ', body: '  Yaprak düşer.  ' },
      { label: 'x', body: '   ' },
      { label: '', body: 'Deniz uyur.' },
    ]);
    expect(request).toEqual({
      genre: 'siir',
      theme: 'Doğa',
      items: [
        { label: 'ChatGPT', body: 'Yaprak düşer.' },
        { label: 'Metin C', body: 'Deniz uyur.' },
      ],
    });
  });

  it('etiketsiz metin, yuvasının harfini alır (ikinci doluysa "Metin B")', () => {
    const request = buildRequest('deneme', 'Aşk', [
      { label: '', body: '' },
      { label: '', body: 'ikinci' },
      { label: '', body: 'üçüncü' },
    ]);
    expect(request.items.map((i) => i.label)).toEqual(['Metin B', 'Metin C']);
  });

  it('hepsi boşsa metin listesi boştur', () => {
    expect(buildRequest('siir', 'Aşk', [{ label: '', body: ' ' }]).items).toEqual([]);
  });
});

describe('bestIndexes', () => {
  it('en yüksek değerin indeksini verir, beraberlikte hepsini', () => {
    expect(bestIndexes([3, 5, 4])).toEqual([1]);
    expect(bestIndexes([5, 5, 4])).toEqual([0, 1]);
  });

  it('null değerleri yok sayar; hiç değer yoksa boş döner', () => {
    expect(bestIndexes([null, 2, null])).toEqual([1]);
    expect(bestIndexes([null, null])).toEqual([]);
    expect(bestIndexes([])).toEqual([]);
  });

  it('negatif ve sıfır değerlerle de çalışır', () => {
    expect(bestIndexes([0, null, 0])).toEqual([0, 2]);
    // Eksik değer 0 sayılırsa -1 "en yüksek" olmaz: null gerçekten yok sayılmalı.
    expect(bestIndexes([-1, null])).toEqual([0]);
  });
});

describe('weightPercents', () => {
  it('ağırlıkları toplamına göre yüzdeye çevirir (0,5/0,3/0,2 ve 50/30/20 aynı sonucu verir)', () => {
    const a = weightPercents([{ weight: 0.5 }, { weight: 0.3 }, { weight: 0.2 }]);
    const b = weightPercents([{ weight: 50 }, { weight: 30 }, { weight: 20 }]);
    expect(a[0]).toBeCloseTo(50);
    expect(a[2]).toBeCloseTo(20);
    b.forEach((value, i) => expect(value).toBeCloseTo(a[i]!));
  });

  it('toplam sıfırsa sıfıra bölmez', () => {
    expect(weightPercents([{ weight: 0 }])).toEqual([0]);
  });
});

describe('rawScore', () => {
  it('başarılı öğenin kriter puanını verir', () => {
    expect(rawScore(succeededItem(1, 'A', 80, { imge: 4 }), 'imge')).toBe(4);
  });

  it('başarısız öğe ya da olmayan kriter için null döner (0 sanılmaz)', () => {
    expect(rawScore(failedItem(2, 'B'), 'imge')).toBeNull();
    expect(rawScore(succeededItem(1, 'A', 80, { imge: 4 }), 'ritim')).toBeNull();
  });
});
