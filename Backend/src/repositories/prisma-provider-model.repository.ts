import { modelParamsSchema } from '../domain/model-params.js';
import type { Db } from '../lib/prisma.js';
import { PROVIDER_IDS, type ProviderId } from '../providers/provider.js';
import type { ProviderModelRecord, ProviderModelRepository } from './provider-model.repository.js';

const isProviderId = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value);

/** MySQL (Prisma) model deposu. Bozuk kayıt (bilinmeyen sağlayıcı, geçersiz ayar) sessizce geçilmez, hata verir. */
export class PrismaProviderModelRepository implements ProviderModelRepository {
  constructor(private readonly db: Db) {}

  async findByIds(ids: number[]): Promise<ProviderModelRecord[]> {
    const rows = await this.db.providerModel.findMany({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => {
      if (!isProviderId(row.provider)) {
        throw new Error(`Model ${row.id}: bilinmeyen sağlayıcı "${row.provider}"`);
      }
      const params = modelParamsSchema.safeParse(row.defaultParams ?? {});
      if (!params.success) {
        throw new Error(`Model ${row.id} (${row.modelId}): varsayılan ayarlar geçersiz`, {
          cause: params.error,
        });
      }
      return {
        id: row.id,
        provider: row.provider,
        modelId: row.modelId,
        displayName: row.displayName,
        active: row.active,
        params: params.data,
      };
    });
  }
}
