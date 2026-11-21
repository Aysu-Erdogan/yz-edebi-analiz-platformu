import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { RubricInput } from '../src/domain/rubric.js';
import { AppError } from '../src/lib/errors.js';
import { DuplicateRubricError, type StoredRubric } from '../src/repositories/rubric.repository.js';
import { createRubricService, type RubricService } from '../src/services/rubric.service.js';
import { sampleRubric } from './contracts/rubric-repository.contract.js';
import { InMemoryRubricRepository } from './fakes/in-memory-rubric.repository.js';

/** Bir söz verinin AppError ile bozulduğunu ve durum/kod bilgisini doğrular. */
async function expectAppError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status, code });
  return error as AppError;
}

describe('rubrik servisi', () => {
  let repo: InMemoryRubricRepository;
  let service: RubricService;
  const now = new Date('2026-11-21T12:00:00.000Z');

  beforeEach(() => {
    repo = new InMemoryRubricRepository();
    service = createRubricService(repo, () => now);
  });

  describe('içe aktarma', () => {
    it('T01: geçerli rubrik taslak olarak kaydedilir', async () => {
      const saved = await service.importRubric(sampleRubric());
      expect(saved).toMatchObject({
        genre: 'siir',
        version: '0.1-taslak',
        status: 'draft',
        usedAt: null,
      });
    });

    it('T02: geçersiz rubrik ZodError ile reddedilir ve hiçbir şey kaydedilmez', async () => {
      const bad = sampleRubric();
      bad.criteria[0]!.weight = 0.9; // toplam 1.4
      await expect(service.importRubric(bad)).rejects.toBeInstanceOf(ZodError);
      await expect(service.importRubric('rubrik değil')).rejects.toBeInstanceOf(ZodError);
      expect(await service.listRubrics()).toEqual([]);
    });

    it('aynı tür ve sürüm ikinci kez içe aktarılamaz (409), yeni sürüm gerekir', async () => {
      await service.importRubric(sampleRubric('siir', '1.0'));
      const error = await expectAppError(
        service.importRubric(sampleRubric('siir', '1.0')),
        409,
        'CONFLICT',
      );
      expect(error.message).toMatch(/siir.*1\.0/);
      await expect(service.importRubric(sampleRubric('siir', '1.1'))).resolves.toBeDefined();
    });

    it('iki istek aynı anda yarışırsa deponun çakışma hatası da 409 olur', async () => {
      class RacingRepository extends InMemoryRubricRepository {
        // Servis ön kontrolde "yok" görür...
        override async findByGenreVersion(): Promise<StoredRubric | null> {
          return null;
        }
        // ...ama kayıt anında depo "başkası araya girdi" der.
        override async create(input: RubricInput): Promise<StoredRubric> {
          throw new DuplicateRubricError(input.genre, input.version);
        }
      }
      const racingService = createRubricService(new RacingRepository(), () => now);
      await expectAppError(racingService.importRubric(sampleRubric()), 409, 'CONFLICT');
    });
  });

  describe('etkinleştirme', () => {
    it('T04: etkinleştirince aynı türdeki önceki sürüm arşivlenir', async () => {
      const v1 = await service.importRubric(sampleRubric('siir', '1.0'));
      const v2 = await service.importRubric(sampleRubric('siir', '2.0'));
      await service.activateRubric(v1.id);
      const activated = await service.activateRubric(v2.id);

      expect(activated.status).toBe('active');
      expect((await service.getRubric(v1.id)).status).toBe('archived');
      expect((await service.getActiveRubric('siir')).id).toBe(v2.id);
    });

    it('etkinleştirme diğer türleri etkilemez', async () => {
      const siir = await service.importRubric(sampleRubric('siir', '1.0'));
      const hikaye = await service.importRubric(sampleRubric('hikaye', '1.0'));
      await service.activateRubric(siir.id);
      await service.activateRubric(hikaye.id);
      expect((await service.getActiveRubric('siir')).id).toBe(siir.id);
      expect((await service.getActiveRubric('hikaye')).id).toBe(hikaye.id);
    });

    it('zaten etkin rubriği tekrar etkinleştirmek zararsızdır (aynı sonuç)', async () => {
      const v1 = await service.importRubric(sampleRubric());
      await service.activateRubric(v1.id);
      expect((await service.activateRubric(v1.id)).status).toBe('active');
    });

    it('arşivlenmiş sürüm geri etkinleştirilebilir (geri dönüş)', async () => {
      const v1 = await service.importRubric(sampleRubric('siir', '1.0'));
      const v2 = await service.importRubric(sampleRubric('siir', '2.0'));
      await service.activateRubric(v1.id);
      await service.activateRubric(v2.id);
      await service.activateRubric(v1.id);
      expect((await service.getActiveRubric('siir')).id).toBe(v1.id);
      expect((await service.getRubric(v2.id)).status).toBe('archived');
    });

    it('olmayan rubrik için 404 döner', async () => {
      await expectAppError(service.activateRubric(12345), 404, 'NOT_FOUND');
    });
  });

  describe('değişmezlik: kullanılmış rubrik değiştirilemez', () => {
    it('kullanılmamış rubrik güncellenebilir', async () => {
      const saved = await service.importRubric(sampleRubric('siir', '1.0'));
      const next = sampleRubric('siir', '1.1');
      const updated = await service.updateRubric(saved.id, next);
      expect(updated.id).toBe(saved.id);
      expect(updated.version).toBe('1.1');
    });

    it('T03: kullanılmış rubrik güncellenemez, yeni sürüm gerektiği söylenir (409)', async () => {
      const saved = await service.importRubric(sampleRubric('siir', '1.0'));
      await service.markUsed(saved.id);
      const error = await expectAppError(
        service.updateRubric(saved.id, sampleRubric('siir', '1.0')),
        409,
        'CONFLICT',
      );
      expect(error.message).toMatch(/kullanıl/);
      expect(error.message).toMatch(/yeni sürüm/);
      // İçerik gerçekten değişmedi.
      expect((await service.getRubric(saved.id)).criteria).toHaveLength(2);
    });

    it('güncelleme de içe aktarma gibi doğrulanır (T02)', async () => {
      const saved = await service.importRubric(sampleRubric());
      const bad = sampleRubric();
      bad.criteria[0]!.weight = 0.9;
      await expect(service.updateRubric(saved.id, bad)).rejects.toBeInstanceOf(ZodError);
    });

    it('güncelleme başka bir rubriğin tür+sürümüyle çakışırsa 409 döner', async () => {
      const a = await service.importRubric(sampleRubric('siir', '1.0'));
      await service.importRubric(sampleRubric('siir', '2.0'));
      await expectAppError(
        service.updateRubric(a.id, sampleRubric('siir', '2.0')),
        409,
        'CONFLICT',
      );
    });

    it('olmayan rubrik için güncelleme 404 döner', async () => {
      await expectAppError(service.updateRubric(1, sampleRubric()), 404, 'NOT_FOUND');
    });

    it('markUsed ilk kullanım zamanını yazar ve sonraki çağrılarda korur', async () => {
      const saved = await service.importRubric(sampleRubric());
      expect((await service.markUsed(saved.id)).usedAt).toEqual(now);

      const laterService = createRubricService(repo, () => new Date('2027-01-01T00:00:00.000Z'));
      expect((await laterService.markUsed(saved.id)).usedAt).toEqual(now);
    });

    it('olmayan rubrik için markUsed 404 döner', async () => {
      await expectAppError(service.markUsed(1), 404, 'NOT_FOUND');
    });

    it('kullanılmış rubrik yine de etkinleştirilebilir (yalnızca içeriği kilitlidir)', async () => {
      const saved = await service.importRubric(sampleRubric());
      await service.markUsed(saved.id);
      expect((await service.activateRubric(saved.id)).status).toBe('active');
    });
  });

  describe('okuma', () => {
    it('T05: bilinmeyen türde etkin rubrik isteği 404 döner, sessizce şiire düşmez', async () => {
      const siir = await service.importRubric(sampleRubric('siir', '1.0'));
      await service.activateRubric(siir.id);
      await expectAppError(service.getActiveRubric('roman'), 404, 'NOT_FOUND');
      await expectAppError(service.getActiveRubric('şiir'), 404, 'NOT_FOUND'); // Türkçe karakterli yazım geçerli tür değil
      await expectAppError(service.getActiveRubric(''), 404, 'NOT_FOUND');
    });

    it('geçerli türde etkin rubrik yoksa 404 döner ve türü söyler', async () => {
      const error = await expectAppError(service.getActiveRubric('deneme'), 404, 'NOT_FOUND');
      expect(error.message).toContain('deneme');
    });

    it('getRubric olmayan kimlik için 404 döner', async () => {
      await expectAppError(service.getRubric(404), 404, 'NOT_FOUND');
    });

    it('listRubrics tür ve durum süzgeciyle çalışır, geçersiz süzgeç 400 döner', async () => {
      const a = await service.importRubric(sampleRubric('siir', '1.0'));
      await service.importRubric(sampleRubric('hikaye', '1.0'));
      await service.activateRubric(a.id);

      expect(await service.listRubrics()).toHaveLength(2);
      expect((await service.listRubrics({ genre: 'siir' })).map((r) => r.id)).toEqual([a.id]);
      expect((await service.listRubrics({ status: 'active' })).map((r) => r.id)).toEqual([a.id]);
      await expectAppError(service.listRubrics({ genre: 'roman' }), 400, 'VALIDATION_ERROR');
      await expectAppError(service.listRubrics({ status: 'bilinmez' }), 400, 'VALIDATION_ERROR');
    });
  });

  describe('dışa aktarma', () => {
    it('dışa aktarılan JSON, içe aktarılan biçimle birebir aynıdır (gidiş-dönüş)', async () => {
      const input = sampleRubric('hikaye', '3.0');
      const saved = await service.importRubric(input);
      const exported = await service.exportRubric(saved.id);
      expect(exported).toEqual(input);
      // Sistem alanları (kimlik, durum, tarih) dışa aktarımda yok.
      expect(exported).not.toHaveProperty('id');
      expect(exported).not.toHaveProperty('status');
    });

    it('dışa aktarılan JSON yeniden içe aktarılabilir (yeni sürüm adıyla)', async () => {
      const saved = await service.importRubric(sampleRubric('siir', '1.0'));
      const exported = await service.exportRubric(saved.id);
      const again = await service.importRubric({ ...exported, version: '1.1' });
      expect(again.criteria).toEqual(saved.criteria);
    });

    it('kaynak notu olmayan rubrik dışa aktarımda sourceNote alanı eklemez', async () => {
      const input = sampleRubric();
      delete input.sourceNote;
      const saved = await service.importRubric(input);
      expect(await service.exportRubric(saved.id)).not.toHaveProperty('sourceNote');
    });

    it('olmayan rubrik için 404 döner', async () => {
      await expectAppError(service.exportRubric(1), 404, 'NOT_FOUND');
    });
  });
});
