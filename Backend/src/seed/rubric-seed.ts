import { rubricInputSchema } from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import type { RubricService } from '../services/rubric.service.js';

/**
 * Taslak rubrikleri yükler. Tekrar çalıştırılabilir: var olan tür+sürüm atlanır. Yüklenen taslak,
 * yalnızca türde etkin rubrik yoksa etkinleştirilir (gerçek bir rubrik varsa onu arşivlemez).
 */
export async function seedRubrics(
  service: RubricService,
  rubrics: unknown[],
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const raw of rubrics) {
    const { genre } = rubricInputSchema.parse(raw);
    let saved;
    try {
      saved = await service.importRubric(raw);
    } catch (error) {
      if (error instanceof AppError && error.code === 'CONFLICT') {
        skipped++;
        continue;
      }
      throw error;
    }
    created++;
    if ((await service.listRubrics({ genre, status: 'active' })).length === 0) {
      await service.activateRubric(saved.id);
    }
  }
  return { created, skipped };
}
