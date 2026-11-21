import { beforeEach, describe, expect, it } from 'vitest';
import type { RubricInput } from '../../src/domain/rubric.js';
import {
  DuplicateRubricError,
  type RubricRepository,
} from '../../src/repositories/rubric.repository.js';

/** Test için geçerli, küçük bir rubrik. Tür ve sürüm değiştirilebilir. */
export function sampleRubric(
  genre: RubricInput['genre'] = 'siir',
  version = '0.1-taslak',
): RubricInput {
  const levels = [
    { score: 1, descriptor: 'zayıf' },
    { score: 5, descriptor: 'çok iyi' },
  ];
  return {
    genre,
    version,
    sourceNote: 'GEÇİCİ TASLAK: uzman doğrulaması yok',
    scale: { min: 1, max: 5 },
    criteria: [
      { key: 'birinci', label: 'Birinci', description: 'ilk kriter', weight: 0.5, levels },
      { key: 'ikinci', label: 'İkinci', description: 'ikinci kriter', weight: 0.5, levels },
    ],
  };
}

/**
 * RubricRepository sözleşmesi. Hem bellek içi sahte hem gerçek MySQL repository'si bu testleri
 * geçmek zorundadır; böylece servis testlerinin güvendiği davranış gerçek depoda da geçerlidir.
 */
export function describeRubricRepositoryContract(
  name: string,
  makeRepo: () => Promise<RubricRepository> | RubricRepository,
): void {
  describe(`RubricRepository sözleşmesi: ${name}`, () => {
    let repo: RubricRepository;
    beforeEach(async () => {
      repo = await makeRepo();
    });

    it('create: taslak olarak kaydeder, kullanılmamış, kriter ve düzey sırası korunur', async () => {
      const input = sampleRubric();
      const saved = await repo.create(input);
      expect(saved.id).toBeGreaterThan(0);
      expect(saved.status).toBe('draft');
      expect(saved.usedAt).toBeNull();
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(saved.genre).toBe('siir');
      expect(saved.criteria.map((c) => c.key)).toEqual(['birinci', 'ikinci']);
      expect(saved.criteria[0]?.levels.map((l) => l.score)).toEqual([1, 5]);
      expect(saved.sourceNote).toBe(input.sourceNote);
    });

    it('create: aynı tür ve sürüm ikinci kez kaydedilemez', async () => {
      await repo.create(sampleRubric('siir', '1.0'));
      await expect(repo.create(sampleRubric('siir', '1.0'))).rejects.toBeInstanceOf(
        DuplicateRubricError,
      );
      // Aynı sürüm başka türde serbest.
      await expect(repo.create(sampleRubric('hikaye', '1.0'))).resolves.toBeDefined();
    });

    it('findById / findByGenreVersion: bulur, yoksa null döner', async () => {
      const saved = await repo.create(sampleRubric('deneme', '2.0'));
      expect((await repo.findById(saved.id))?.version).toBe('2.0');
      expect((await repo.findByGenreVersion('deneme', '2.0'))?.id).toBe(saved.id);
      expect(await repo.findById(999_999)).toBeNull();
      expect(await repo.findByGenreVersion('deneme', 'yok')).toBeNull();
    });

    it('list: kimliğe göre artan sıralar ve tür/durum süzgeciyle daraltır', async () => {
      const a = await repo.create(sampleRubric('siir', '1.0'));
      const b = await repo.create(sampleRubric('hikaye', '1.0'));
      const c = await repo.create(sampleRubric('siir', '2.0'));
      await repo.activate(c.id);

      expect((await repo.list()).map((r) => r.id)).toEqual([a.id, b.id, c.id]);
      expect((await repo.list({ genre: 'siir' })).map((r) => r.id)).toEqual([a.id, c.id]);
      expect((await repo.list({ status: 'active' })).map((r) => r.id)).toEqual([c.id]);
      expect(await repo.list({ genre: 'hikaye', status: 'active' })).toEqual([]);
    });

    it('findActive: etkin rubriği döner, yoksa null', async () => {
      expect(await repo.findActive('siir')).toBeNull();
      const saved = await repo.create(sampleRubric());
      expect(await repo.findActive('siir')).toBeNull(); // taslak etkin sayılmaz
      await repo.activate(saved.id);
      expect((await repo.findActive('siir'))?.id).toBe(saved.id);
    });

    it('activate: aynı türdeki önceki etkin rubrik arşivlenir, diğer türler etkilenmez', async () => {
      const v1 = await repo.create(sampleRubric('siir', '1.0'));
      const v2 = await repo.create(sampleRubric('siir', '2.0'));
      const other = await repo.create(sampleRubric('hikaye', '1.0'));
      await repo.activate(v1.id);
      await repo.activate(other.id);

      const activated = await repo.activate(v2.id);
      expect(activated?.status).toBe('active');
      expect((await repo.findById(v1.id))?.status).toBe('archived');
      expect((await repo.findById(v2.id))?.status).toBe('active');
      expect((await repo.findById(other.id))?.status).toBe('active');
      expect((await repo.list({ genre: 'siir', status: 'active' })).map((r) => r.id)).toEqual([
        v2.id,
      ]);
    });

    it('activate: olmayan rubrik için null döner ve hiçbir şeyi değiştirmez', async () => {
      const v1 = await repo.create(sampleRubric());
      await repo.activate(v1.id);
      expect(await repo.activate(999_999)).toBeNull();
      expect((await repo.findById(v1.id))?.status).toBe('active');
    });

    it('markUsed: ilk kullanım zamanını yazar, ikinci çağrı ilk değeri korur', async () => {
      const saved = await repo.create(sampleRubric());
      const first = new Date('2026-11-21T10:00:00.000Z');
      const later = new Date('2026-12-01T10:00:00.000Z');
      expect((await repo.markUsed(saved.id, first))?.usedAt?.toISOString()).toBe(
        first.toISOString(),
      );
      expect((await repo.markUsed(saved.id, later))?.usedAt?.toISOString()).toBe(
        first.toISOString(),
      );
      expect(await repo.markUsed(999_999, first)).toBeNull();
    });

    it('replace: içeriği tümüyle değiştirir; durum, kullanım ve kimlik korunur', async () => {
      const saved = await repo.create(sampleRubric('siir', '1.0'));
      await repo.activate(saved.id);

      const next = sampleRubric('siir', '1.1');
      next.criteria = [{ ...next.criteria[0]!, key: 'yeni', weight: 1 }];
      const replaced = await repo.replace(saved.id, next);

      expect(replaced?.id).toBe(saved.id);
      expect(replaced?.version).toBe('1.1');
      expect(replaced?.status).toBe('active');
      expect(replaced?.criteria.map((c) => c.key)).toEqual(['yeni']);
      expect((await repo.findById(saved.id))?.criteria).toHaveLength(1);
    });

    it('replace: yeni tür+sürüm başka bir rubriğe aitse reddeder, olmayan rubrik için null döner', async () => {
      const a = await repo.create(sampleRubric('siir', '1.0'));
      await repo.create(sampleRubric('siir', '2.0'));
      await expect(repo.replace(a.id, sampleRubric('siir', '2.0'))).rejects.toBeInstanceOf(
        DuplicateRubricError,
      );
      // Kendi tür+sürümünü korumak çakışma sayılmaz.
      await expect(repo.replace(a.id, sampleRubric('siir', '1.0'))).resolves.toBeDefined();
      expect(await repo.replace(999_999, sampleRubric())).toBeNull();
    });
  });
}
