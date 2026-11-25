import { describe, expect, it } from 'vitest';
import { claude, evaluation } from '../../test/library-fixture';
import { NO_FILTERS, buildQuery, groupEvaluations, hasFilters, mean, writerName } from './data';

describe('buildQuery / hasFilters', () => {
  it('süzgeç yoksa boş dize verir', () => {
    expect(buildQuery(NO_FILTERS)).toBe('');
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it('yalnızca dolu süzgeçleri yazar; Türkçe karakterleri kodlar', () => {
    expect(buildQuery({ genre: 'siir', theme: '', source: '' })).toBe('?genre=siir');
    expect(buildQuery({ genre: 'hikaye', theme: 'Doğa', source: 'manual' })).toBe(
      '?genre=hikaye&theme=Do%C4%9Fa&source=manual',
    );
    expect(hasFilters({ genre: '', theme: 'Aşk', source: '' })).toBe(true);
    // Üç süzgeçten her biri tek başına "süzgeç var" sayılır.
    expect(hasFilters({ genre: 'siir', theme: '', source: '' })).toBe(true);
    expect(hasFilters({ genre: '', theme: '', source: 'manual' })).toBe(true);
  });
});

describe('writerName', () => {
  it('üretilen metinde model adı, elle girilende etiket; ikisi de yoksa "Etiketsiz"', () => {
    expect(writerName({ author: claude, label: null })).toBe('Claude Sonnet 5.5');
    expect(writerName({ author: null, label: 'ChatGPT' })).toBe('ChatGPT');
    expect(writerName({ author: null, label: null })).toBe('Etiketsiz');
  });

  it('yazar varsa etiket yok sayılır', () => {
    expect(writerName({ author: claude, label: 'başka' })).toBe('Claude Sonnet 5.5');
  });
});

describe('mean', () => {
  it('ortalama alır; boş listede null verir (0 sanılmaz)', () => {
    expect(mean([2, 4])).toBe(3);
    expect(mean([])).toBeNull();
  });
});

describe('groupEvaluations', () => {
  it('aynı hakem, rubrik ve komut sürümünü tek koşulda toplar; farklı koşulları ayırır', () => {
    const groups = groupEvaluations([
      evaluation(1, 1),
      evaluation(2, 1, { judge: 'anthropic/claude', templateVersion: null }),
      evaluation(3, 2),
      evaluation(4, 1, { rubricVersion: '0.2' }),
    ]);
    expect(
      groups.map((g) => [g.judge, g.rubricVersion, g.templateVersion, g.replicates.length]),
    ).toEqual([
      ['deepseek/deepseek-flash', '0.1-taslak', 'v1', 2],
      ['anthropic/claude', '0.1-taslak', null, 1],
      ['deepseek/deepseek-flash', '0.2', 'v1', 1],
    ]);
  });

  it('tekrarları numarasına göre sıralar; toplam ortalamasını yalnızca başarılı tekrarlardan alır', () => {
    const [g] = groupEvaluations([
      evaluation(3, 3, { totalScore: 90 }),
      evaluation(1, 1, { totalScore: 60 }),
      evaluation(2, 2, { status: 'failed', totalScore: null, scores: [], error: 'x' }),
    ]);
    expect(g!.replicates.map((e) => e.replicateNo)).toEqual([1, 2, 3]);
    expect(g!.succeeded.map((e) => e.replicateNo)).toEqual([1, 3]);
    expect(g!.meanTotal).toBe(75);
  });

  it('kriter ortalamasını başarılı tekrarlardan, ilk başarılı tekrarın kriter sırasıyla verir', () => {
    const [g] = groupEvaluations([
      evaluation(1, 1, {
        scores: [
          { key: 'a', label: 'A', score: 2, comment: null },
          { key: 'b', label: 'B', score: 4, comment: null },
        ],
      }),
      evaluation(2, 2, {
        scores: [
          { key: 'a', label: 'A', score: 4, comment: null },
          { key: 'b', label: 'B', score: 5, comment: null },
        ],
      }),
    ]);
    expect(g!.criteria).toEqual([
      { key: 'a', label: 'A', mean: 3 },
      { key: 'b', label: 'B', mean: 4.5 },
    ]);
  });

  it('ilk tekrar başarısızsa kriterler ilk başarılı tekrardan gelir; başarısız kaydın artık puanı ortalamaya girmez', () => {
    const [g] = groupEvaluations([
      // Başarısız kayıtta puan olmaması beklenir; olsa bile ortalamayı bozmamalı.
      evaluation(1, 1, {
        status: 'failed',
        totalScore: null,
        error: 'x',
        scores: [
          { key: 'a', label: 'A', score: 1, comment: null },
          { key: 'artik', label: 'Artık', score: 2, comment: null },
        ],
      }),
      evaluation(2, 2, { scores: [{ key: 'a', label: 'A', score: 5, comment: null }] }),
      evaluation(3, 3, { scores: [{ key: 'a', label: 'A', score: 3, comment: null }] }),
    ]);
    expect(g!.criteria).toEqual([{ key: 'a', label: 'A', mean: 4 }]);
  });

  it('hiç başarılı tekrar yoksa ortalama null, kriter listesi boş', () => {
    const [g] = groupEvaluations([
      evaluation(1, 1, { status: 'failed', totalScore: null, scores: [], error: 'x' }),
    ]);
    expect(g).toMatchObject({ meanTotal: null, criteria: [], succeeded: [] });
    expect(g!.replicates).toHaveLength(1);
  });

  it('durumu succeeded ama puanı boş kaydı başarılı saymaz (0 ortalamaya girmez)', () => {
    const [g] = groupEvaluations([
      evaluation(1, 1, { totalScore: 80 }),
      evaluation(2, 2, { totalScore: null }),
    ]);
    expect(g!.succeeded).toHaveLength(1);
    expect(g!.meanTotal).toBe(80);
  });

  it('kayıt yoksa grup yok', () => {
    expect(groupEvaluations([])).toEqual([]);
  });
});
