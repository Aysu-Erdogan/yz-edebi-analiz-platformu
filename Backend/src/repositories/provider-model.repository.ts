import type { ModelParams } from '../domain/model-params.js';
import type { ProviderId } from '../providers/provider.js';

/** Kayıtlı bir model: hangi sağlayıcıdaki hangi model, açık mı, varsayılan çağrı ayarları nelerdir. */
export interface ProviderModelRecord {
  id: number;
  provider: ProviderId;
  modelId: string;
  displayName: string;
  active: boolean;
  params: ModelParams;
}

export interface ProviderModelRepository {
  /** Bulunanları döner; olmayan kimlikler listede yer almaz. Kapalı modeller de gelir (`active` alanına bakılır). */
  findByIds(ids: number[]): Promise<ProviderModelRecord[]>;
}
