import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/lib/prisma.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import {
  describeRubricRepositoryContract,
  sampleRubric,
} from './contracts/rubric-repository.contract.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

if (url) {
  assertSafeTestDatabase(url); // gerçek veritabanıysa burada durur
  const db = createDb(url);
  afterAll(async () => {
    await db.$disconnect();
  });

  /** Her testten önce rubrik tablolarını boşaltır (kriter ve düzeyler zincirleme silinir). */
  const clean = async () => {
    await db.rubric.deleteMany();
  };

  // Servis testlerinin güvendiği sahte depoyla aynı sözleşme, gerçek MySQL'de de geçerli olmalı.
  describeRubricRepositoryContract('MySQL (Prisma)', async () => {
    await clean();
    return new PrismaRubricRepository(db);
  });

  describe('MySQL repository: veritabanına özgü davranışlar', () => {
    let repo: PrismaRubricRepository;
    beforeEach(async () => {
      await clean();
      repo = new PrismaRubricRepository(db);
    });

    it('replace: eski kriter ve düzey satırlarını siler, yetim kayıt bırakmaz', async () => {
      const saved = await repo.create(sampleRubric('siir', '1.0')); // 2 kriter x 2 düzey
      expect(await db.rubricCriterion.count()).toBe(2);
      expect(await db.rubricLevel.count()).toBe(4);

      const next = sampleRubric('siir', '1.0');
      next.criteria = [{ ...next.criteria[0]!, key: 'tek', weight: 1 }];
      await repo.replace(saved.id, next);

      expect(await db.rubricCriterion.count()).toBe(1);
      expect(await db.rubricLevel.count()).toBe(2);
    });

    it('replace: çakışma olursa işlem geri alınır, eski içerik bozulmaz', async () => {
      const a = await repo.create(sampleRubric('siir', '1.0'));
      await repo.create(sampleRubric('siir', '2.0'));
      await expect(repo.replace(a.id, sampleRubric('siir', '2.0'))).rejects.toThrow();
      const unchanged = await repo.findById(a.id);
      expect(unchanged?.version).toBe('1.0');
      expect(unchanged?.criteria.map((c) => c.key)).toEqual(['birinci', 'ikinci']); // silinmedi
    });

    it('ağırlıklar ondalık olarak aynen saklanır (0.1, 0.2, 0.7)', async () => {
      const input = sampleRubric();
      const levels = input.criteria[0]!.levels;
      input.criteria = [
        { key: 'a', label: 'A', description: 'a', weight: 0.1, levels },
        { key: 'b', label: 'B', description: 'b', weight: 0.2, levels },
        { key: 'c', label: 'C', description: 'c', weight: 0.7, levels },
      ];
      const saved = await repo.create(input);
      expect((await repo.findById(saved.id))?.criteria.map((c) => c.weight)).toEqual([
        0.1, 0.2, 0.7,
      ]);
    });

    it('Türkçe karakterler ve emoji bozulmadan saklanır (utf8mb4)', async () => {
      const input = sampleRubric();
      input.sourceNote = 'GEÇİCİ TASLAK: ğüşıöçĞÜŞİÖÇ 😀';
      input.criteria[0]!.label = 'Özgünlük ve İmge Şiiri';
      input.criteria[0]!.levels[0]!.descriptor = 'çok zayıf: ğ, ü, ş, ı, ö, ç';
      const saved = await repo.create(input);
      const found = await repo.findById(saved.id);
      expect(found?.sourceNote).toBe(input.sourceNote);
      expect(found?.criteria[0]?.label).toBe('Özgünlük ve İmge Şiiri');
      expect(found?.criteria[0]?.levels[0]?.descriptor).toBe('çok zayıf: ğ, ü, ş, ı, ö, ç');
    });

    it('kaynak notu olmayan rubrikte sourceNote alanı hiç gelmez', async () => {
      const input = sampleRubric();
      delete input.sourceNote;
      const saved = await repo.create(input);
      expect(await repo.findById(saved.id)).not.toHaveProperty('sourceNote');
    });

    it('düzeyler puana göre artan sırada gelir', async () => {
      const input = sampleRubric();
      input.criteria[0]!.levels = [
        { score: 5, descriptor: 'çok iyi' },
        { score: 3, descriptor: 'orta' },
        { score: 1, descriptor: 'zayıf' },
      ];
      const saved = await repo.create(input);
      expect((await repo.findById(saved.id))?.criteria[0]?.levels.map((l) => l.score)).toEqual([
        1, 3, 5,
      ]);
    });
  });
} else if (process.env.CI) {
  // CI'da MySQL testlerinin atlanmasına izin yok: sessizce yeşil görünürdü.
  describe('MySQL repository', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL repository (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
