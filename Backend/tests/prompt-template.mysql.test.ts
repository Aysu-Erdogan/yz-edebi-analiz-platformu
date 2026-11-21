import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { renderPrompt } from '../src/domain/prompt.js';
import { createDb } from '../src/lib/prisma.js';
import { AppError } from '../src/lib/errors.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { seedPrompts } from '../src/seed/prompt-seed.js';
import {
  createPromptTemplateService,
  type PromptTemplateService,
} from '../src/services/prompt-template.service.js';
import { cleanGenerationData } from './support/db-clean.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();
const body = 'Tür: {{tur}}\nTema: {{tema}}\nUzunluk: {{uzunluk}}';
const template = (version: string, text = body) => ({ kind: 'generate', version, body: text });

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  afterAll(async () => {
    await db.$disconnect();
  });

  describe('MySQL: sürümlü komut şablonu', () => {
    let service: PromptTemplateService;
    beforeEach(async () => {
      await cleanGenerationData(db);
      service = createPromptTemplateService(new PrismaPromptTemplateRepository(db));
    });

    it('şablonu kaydeder, aynen geri okur ve doldurulabilir', async () => {
      const saved = await service.createTemplate(template('v1'));
      expect(saved).toMatchObject({ kind: 'generate', version: 'v1', body });
      expect(saved.id).toBeGreaterThan(0);
      expect(saved.createdAt).toBeInstanceOf(Date);

      const found = await service.getTemplate(saved.id);
      expect(
        renderPrompt(found.body, { tur: 'şiir', tema: 'Deniz', uzunluk: '3-5 kıta' }),
      ).toContain('Tema: Deniz');
    });

    it('Türkçe karakterler bozulmadan saklanır (utf8mb4)', async () => {
      const text = `${body}\nÖzgün, ğüşıöçĞÜŞİÖÇ yaz.`;
      const saved = await service.createTemplate(template('v1', text));
      expect((await service.getTemplate(saved.id)).body).toBe(text);
    });

    it('aynı sürüm ikinci kez kaydedilemez (409): değişiklik yeni sürüm olarak yazılır', async () => {
      await service.createTemplate(template('v1'));
      const error = await appError(service.createTemplate(template('v1', `${body}\nEk.`)));
      expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
      expect(error.message).toContain('v1');
      expect((await service.getLatest('generate')).body).toBe(body); // eskisi değişmedi
    });

    it('geçersiz şablon (eksik boşluk) kaydedilmez', async () => {
      await expect(service.createTemplate(template('v1', 'Tema: {{tema}}'))).rejects.toThrow();
      expect(await db.promptTemplate.count()).toBe(0);
    });

    it('getLatest: en son kaydedilen sürümü verir; hiç yoksa 404', async () => {
      await expect(service.getLatest('generate')).rejects.toMatchObject({ status: 404 });
      await service.createTemplate(template('v1'));
      await service.createTemplate(template('v2', `${body}\nİkinci sürüm.`));
      expect((await service.getLatest('generate')).version).toBe('v2');
    });

    it('getTemplate: olmayan kimlik 404 döner', async () => {
      expect(await appError(service.getTemplate(999_999))).toMatchObject({ status: 404 });
    });

    it('seed tekrar çalıştırılabilir: var olan sürüme dokunmaz', async () => {
      const items = [template('v1')];
      expect(await seedPrompts(service, items)).toEqual({ created: 1, skipped: 0 });
      expect(await seedPrompts(service, items)).toEqual({ created: 0, skipped: 1 });
      expect(await db.promptTemplate.count()).toBe(1);
    });
  });
} else if (process.env.CI) {
  describe('MySQL: sürümlü komut şablonu', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: sürümlü komut şablonu (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
