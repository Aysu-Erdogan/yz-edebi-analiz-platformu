import { describe, expect, it } from 'vitest';
import { rubrics } from '../../test/rubric-fixture';
import { normalizedScore, rubricsOfGenre, type Rubric } from './data';

describe('rubricsOfGenre', () => {
  it('yalnızca istenen türün rubriklerini verir: etkin, sonra taslak, sonra arşiv', () => {
    expect(rubricsOfGenre(rubrics, 'siir').map((r) => [r.version, r.status])).toEqual([
      ['0.1-taslak', 'active'],
      ['0.2', 'draft'],
      ['0.0', 'archived'],
    ]);
    expect(rubricsOfGenre(rubrics, 'hikaye').map((r) => r.id)).toEqual([4]);
  });

  it('aynı durumdaki rubriklerde yeni kayıt önce gelir', () => {
    const list: Rubric[] = [
      { ...rubrics[2]!, id: 10, version: 'a' },
      { ...rubrics[2]!, id: 30, version: 'c' },
      { ...rubrics[2]!, id: 20, version: 'b' },
    ];
    expect(rubricsOfGenre(list, 'siir').map((r) => r.version)).toEqual(['c', 'b', 'a']);
  });

  it('kaydı olmayan tür için boş liste döner, girdiyi değiştirmez', () => {
    const before = rubrics.map((r) => r.id);
    expect(rubricsOfGenre(rubrics, 'deneme')).toEqual([]);
    rubricsOfGenre(rubrics, 'siir');
    expect(rubrics.map((r) => r.id)).toEqual(before);
  });
});

describe('normalizedScore (ADR 0009: aralık tabanlı)', () => {
  it('ölçeğin en düşüğü 0, en yükseği 100, ortası 50', () => {
    const scale = { min: 1, max: 5 };
    expect([1, 3, 5].map((s) => normalizedScore(s, scale))).toEqual([0, 50, 100]);
  });

  it('başka ölçekte de çalışır (1-4 ölçeğinde 3 puan yaklaşık 66,7)', () => {
    expect(normalizedScore(3, { min: 1, max: 4 })).toBeCloseTo(66.667, 2);
    expect(normalizedScore(0, { min: 0, max: 10 })).toBe(0);
  });
});
