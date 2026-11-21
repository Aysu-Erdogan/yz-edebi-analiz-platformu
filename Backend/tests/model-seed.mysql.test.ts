import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/lib/prisma.js';
import { seedModels, type ModelSeed } from '../src/seed/model-seed.js';
import { cleanGenerationData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

const models: ModelSeed[] = [
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    active: true,
    defaultParams: { maxTokens: 8192 },
  },
  {
    provider: 'google',
    modelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    active: true,
  },
];

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  afterAll(async () => {
    await db.$disconnect();
  });

  describe('MySQL: model listesi seed', () => {
    beforeEach(async () => {
      await cleanGenerationData(db);
    });

    it('modelleri yükler, parametreleri JSON olarak saklar', async () => {
      expect(await seedModels(db, models)).toEqual({ created: 2, skipped: 0 });
      const rows = await db.providerModel.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => `${r.provider}/${r.modelId}`)).toEqual([
        'anthropic/claude-sonnet-5-5',
        'google/gemini-3.8-flash',
      ]);
      expect(rows[0]).toMatchObject({ displayName: 'Claude Sonnet 5.5', active: true });
      expect(rows[0]?.defaultParams).toEqual({ maxTokens: 8192 });
      expect(rows[1]?.defaultParams).toBeNull();
    });

    it('tekrar çalıştırılabilir: aynı modeli ikinci kez eklemez', async () => {
      await seedModels(db, models);
      expect(await seedModels(db, models)).toEqual({ created: 0, skipped: 2 });
      expect(await db.providerModel.count()).toBe(2);
    });

    it('var olan kayda dokunmaz: yöneticinin kapattığı model yeniden açılmaz, parametresi ezilmez', async () => {
      await seedModels(db, models);
      await db.providerModel.updateMany({
        where: { modelId: 'claude-sonnet-5-5' },
        data: { active: false, defaultParams: { maxTokens: 1000 } },
      });

      await seedModels(db, models);

      const row = await db.providerModel.findFirstOrThrow({
        where: { modelId: 'claude-sonnet-5-5' },
      });
      expect(row.active).toBe(false);
      expect(row.defaultParams).toEqual({ maxTokens: 1000 });
    });

    it('yeni bir model eklenince yalnızca onu yükler', async () => {
      await seedModels(db, models.slice(0, 1));
      const result = await seedModels(db, models);
      expect(result).toEqual({ created: 1, skipped: 1 });
    });
  });
} else if (process.env.CI) {
  describe('MySQL: model listesi seed', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: model listesi seed (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
