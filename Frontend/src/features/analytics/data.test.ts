import { describe, expect, it } from 'vitest';
import { A, B, condition } from '../../test/analytics-fixture';
import { authorsOf, heatAlpha, heatTable, modelName, rubricLookup, scopeLabel } from './data';

describe('authorsOf / modelName', () => {
  it('yazarları "tüm türler" kırılımının sırasıyla verir', () => {
    expect(authorsOf(condition)).toEqual([A, B]);
  });

  it('model adından sağlayıcıyı atar, eğik çizgisiz adı olduğu gibi bırakır', () => {
    expect(modelName(A)).toBe('claude-a');
    expect(modelName('yalniz-ad')).toBe('yalniz-ad');
  });
});

describe('heatTable', () => {
  it('model × tür tablosunu kurar: sütunlar Türkçe tür adıdır', () => {
    const heat = heatTable(condition, 'tür ');
    expect(heat.columns).toEqual([
      { key: 'siir', label: 'Şiir' },
      { key: 'hikaye', label: 'Hikâye' },
    ]);
    expect(heat.rows[0]).toEqual({
      author: A,
      cells: [
        { mean: 80, n: 3 },
        { mean: 60, n: 3 },
      ],
    });
    expect(heat.min).toBe(40);
    expect(heat.max).toBe(80);
  });

  it('bir modelin o türde metni yoksa hücre null olur (0 gibi gösterilmez)', () => {
    expect(heatTable(condition, 'tür ').rows[1]!.cells).toEqual([{ mean: 40, n: 3 }, null]);
  });

  it('tema sütunlarını olduğu gibi (çevirmeden) verir', () => {
    expect(heatTable(condition, 'tema ').columns).toEqual([{ key: 'Aşk', label: 'Aşk' }]);
  });

  it('hiç değer yoksa min ve max 0 olur (Infinity sızmaz)', () => {
    const empty = { ...condition, kirilimlar: [{ etiket: 'tüm türler', gruplar: [] }] };
    expect(heatTable(empty, 'tür ')).toMatchObject({ columns: [], rows: [], min: 0, max: 0 });
  });
});

describe('heatAlpha', () => {
  it('en düşük değer 0.05, en yüksek 0.35, ortası 0.2', () => {
    expect(heatAlpha(40, 40, 80)).toBeCloseTo(0.05);
    expect(heatAlpha(80, 40, 80)).toBeCloseTo(0.35);
    expect(heatAlpha(60, 40, 80)).toBeCloseTo(0.2);
  });

  it('tüm değerler eşitse sıfıra bölmez', () => {
    expect(heatAlpha(70, 70, 70)).toBe(0.2);
  });
});

describe('scopeLabel', () => {
  it('kapsam etiketlerini okunur yapar', () => {
    expect(scopeLabel('tür siir')).toBe('Tür: Şiir');
    expect(scopeLabel('tema Aşk')).toBe('Tema: Aşk');
    expect(scopeLabel('tüm türler')).toBe('Tüm türler');
    expect(scopeLabel('tür yenitur')).toBe('Tür: yenitur');
  });
});

describe('rubricLookup', () => {
  const rubrics = [
    {
      genre: 'siir',
      version: '1',
      scale: { min: 1, max: 4 },
      criteria: [{ key: 'imge', label: 'İmge gücü' }],
    },
  ];

  it('kriter adını ve ölçek üst sınırını rubrikten alır', () => {
    const r = rubricLookup(rubrics, 'siir', '1');
    expect(r.label('imge')).toBe('İmge gücü');
    expect(r.scaleMax).toBe(4);
  });

  it('rubrik bulunamazsa (ya da hiç gelmediyse) anahtarı ve 5 ölçeğini kullanır', () => {
    for (const r of [rubricLookup(rubrics, 'siir', '2'), rubricLookup(undefined, 'siir', '1')]) {
      expect(r.label('imge')).toBe('imge');
      expect(r.scaleMax).toBe(5);
    }
  });
});
