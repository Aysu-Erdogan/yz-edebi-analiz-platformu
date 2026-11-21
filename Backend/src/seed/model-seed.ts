import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import { PROVIDER_IDS } from '../providers/provider.js';

/** Karşılaştırılan model listesi, kod değil veridir (ADR 0010): model emekli olunca kayıt güncellenir. */
export const modelSeedSchema = z.strictObject({
  provider: z.enum(PROVIDER_IDS),
  modelId: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(128),
  active: z.boolean().default(true),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
});
export type ModelSeed = z.input<typeof modelSeedSchema>;

/**
 * Modelleri yükler. Tekrar çalıştırılabilir ve var olan kayda dokunmaz: yöneticinin kapattığı bir model
 * (active) ya da ayarladığı parametreler yeniden çalıştırmada ezilmez.
 */
export async function seedModels(
  db: Db,
  models: unknown[],
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const raw of models) {
    const model = modelSeedSchema.parse(raw);
    const { provider, modelId } = model;
    const exists = await db.providerModel.findUnique({
      where: { provider_modelId: { provider, modelId } },
      select: { id: true },
    });
    if (exists) {
      skipped++;
      continue;
    }
    await db.providerModel.create({
      data: {
        provider,
        modelId,
        displayName: model.displayName,
        active: model.active,
        ...(model.defaultParams && {
          defaultParams: model.defaultParams as Prisma.InputJsonObject,
        }),
      },
    });
    created++;
  }
  return { created, skipped };
}
