import { AppError } from '../lib/errors.js';
import type { PromptTemplateService } from '../services/prompt-template.service.js';

/** Şablonları yükler. Tekrar çalıştırılabilir: var olan tür+sürüm atlanır, hiçbir şablon değişmez. */
export async function seedPrompts(
  service: PromptTemplateService,
  templates: unknown[],
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const raw of templates) {
    try {
      await service.createTemplate(raw);
      created++;
    } catch (error) {
      if (error instanceof AppError && error.code === 'CONFLICT') {
        skipped++;
        continue;
      }
      throw error;
    }
  }
  return { created, skipped };
}
