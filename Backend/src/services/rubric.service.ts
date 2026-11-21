import {
  GENRES,
  RUBRIC_STATUSES,
  rubricInputSchema,
  type Genre,
  type RubricInput,
  type RubricStatus,
} from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import {
  DuplicateRubricError,
  type RubricRepository,
  type StoredRubric,
} from '../repositories/rubric.repository.js';

export interface RubricService {
  /** Doğrular ve taslak olarak kaydeder. Aynı tür+sürüm varsa 409. */
  importRubric(raw: unknown): Promise<StoredRubric>;
  /** İçeriği değiştirir. Kullanılmış rubrik değiştirilemez (409), yeni sürüm gerekir (T03). */
  updateRubric(id: number, raw: unknown): Promise<StoredRubric>;
  /** Etkinleştirir; aynı türdeki önceki etkin rubrik arşivlenir (T04). */
  activateRubric(id: number): Promise<StoredRubric>;
  /** Rubrik bir değerlendirmede kullanıldı: ilk kullanım zamanını kaydeder, içeriği kilitler. */
  markUsed(id: number): Promise<StoredRubric>;
  getRubric(id: number): Promise<StoredRubric>;
  listRubrics(filter?: { genre?: string; status?: string }): Promise<StoredRubric[]>;
  /** Bilinmeyen tür 404 döner, sessizce şiire düşmez (T05). */
  getActiveRubric(genre: string): Promise<StoredRubric>;
  /** İçe aktarılan biçimde JSON (kimlik, durum ve tarih olmadan). */
  exportRubric(id: number): Promise<RubricInput>;
}

const isGenre = (value: string): value is Genre => (GENRES as readonly string[]).includes(value);
const isStatus = (value: string): value is RubricStatus =>
  (RUBRIC_STATUSES as readonly string[]).includes(value);

function duplicateError(genre: string, version: string): AppError {
  return AppError.conflict(
    `Bu tür ve sürümde rubrik zaten var: ${genre} ${version}. Değişiklik için yeni bir sürüm adı kullanın.`,
  );
}

/** Depolanmış rubriği içe aktarma biçimine çevirir (yalnızca girdi alanları). */
function toInput(rubric: StoredRubric): RubricInput {
  return {
    genre: rubric.genre,
    version: rubric.version,
    ...(rubric.sourceNote !== undefined && { sourceNote: rubric.sourceNote }),
    scale: { min: rubric.scale.min, max: rubric.scale.max },
    criteria: rubric.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      weight: c.weight,
      levels: c.levels.map((l) => ({ score: l.score, descriptor: l.descriptor })),
    })),
  };
}

/**
 * Rubrik iş kuralları. Veriye yalnızca `RubricRepository` üzerinden erişir.
 * Yönetici yetkisi (içe aktarma, güncelleme, etkinleştirme) F4'te rota katmanına eklenecek.
 */
export function createRubricService(
  repo: RubricRepository,
  clock: () => Date = () => new Date(),
): RubricService {
  const mustGet = async (id: number): Promise<StoredRubric> => {
    const rubric = await repo.findById(id);
    if (!rubric) throw AppError.notFound(`Rubrik bulunamadı: ${id}`);
    return rubric;
  };

  return {
    async importRubric(raw) {
      const input = rubricInputSchema.parse(raw);
      if (await repo.findByGenreVersion(input.genre, input.version)) {
        throw duplicateError(input.genre, input.version);
      }
      try {
        return await repo.create(input);
      } catch (error) {
        // İki istek aynı anda gelirse ön kontrolü ikisi de geçer; benzersizlik kuralını depo yakalar.
        if (error instanceof DuplicateRubricError) throw duplicateError(input.genre, input.version);
        throw error;
      }
    },

    async updateRubric(id, raw) {
      const input = rubricInputSchema.parse(raw);
      const current = await mustGet(id);
      if (current.usedAt) {
        throw AppError.conflict(
          'Bu rubrik bir değerlendirmede kullanıldı ve değiştirilemez. Değişiklik için yeni sürüm olarak içe aktarın.',
        );
      }
      try {
        const replaced = await repo.replace(id, input);
        if (!replaced) throw AppError.notFound(`Rubrik bulunamadı: ${id}`);
        return replaced;
      } catch (error) {
        if (error instanceof DuplicateRubricError) throw duplicateError(input.genre, input.version);
        throw error;
      }
    },

    async activateRubric(id) {
      const rubric = await mustGet(id);
      if (rubric.status === 'active') return rubric;
      const activated = await repo.activate(id);
      if (!activated) throw AppError.notFound(`Rubrik bulunamadı: ${id}`);
      return activated;
    },

    async markUsed(id) {
      await mustGet(id);
      const marked = await repo.markUsed(id, clock());
      if (!marked) throw AppError.notFound(`Rubrik bulunamadı: ${id}`);
      return marked;
    },

    getRubric: mustGet,

    async listRubrics(filter = {}) {
      const { genre, status } = filter;
      if (genre !== undefined && !isGenre(genre)) {
        throw AppError.validation(`Geçersiz tür: ${genre}`);
      }
      if (status !== undefined && !isStatus(status)) {
        throw AppError.validation(`Geçersiz durum: ${status}`);
      }
      return repo.list({
        ...(genre !== undefined && { genre: genre as Genre }),
        ...(status !== undefined && { status: status as RubricStatus }),
      });
    },

    async getActiveRubric(genre) {
      if (!isGenre(genre)) throw AppError.notFound(`Bilinmeyen tür: ${genre}`);
      const active = await repo.findActive(genre);
      if (!active) throw AppError.notFound(`${genre} türü için etkin rubrik yok`);
      return active;
    },

    async exportRubric(id) {
      return toInput(await mustGet(id));
    },
  };
}
