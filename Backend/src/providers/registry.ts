import { AppError } from '../lib/errors.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GoogleProvider } from './google-provider.js';
import type { LLMProvider, ProviderId } from './provider.js';

export interface ProviderConfig {
  /** Anahtarı tanımsız (boş) sağlayıcı devre dışı sayılır. */
  anthropicKey?: string | undefined;
  googleKey?: string | undefined;
  /** Test ve geliştirme için sahte sağlayıcı; verilmezse kullanılamaz. */
  mock?: LLMProvider;
  /** Testlerde sahte HTTP vermek için. */
  fetch?: typeof fetch;
}

export interface ProviderRegistry {
  /** Sağlayıcı kullanılamıyorsa 503 verir: sessizce başka bir şeye düşülmez (ADR 0004). */
  get(id: ProviderId): LLMProvider;
}

/** Hangi model kaydının hangi çevirmenle konuşacağını seçer. OpenAI adaptörü henüz yok. */
export function createProviderRegistry(config: ProviderConfig): ProviderRegistry {
  const available = new Map<ProviderId, LLMProvider>();
  const fetchOption = config.fetch ? { fetch: config.fetch } : {};
  if (config.anthropicKey?.trim()) {
    available.set(
      'anthropic',
      new AnthropicProvider({ apiKey: config.anthropicKey, ...fetchOption }),
    );
  }
  if (config.googleKey?.trim()) {
    available.set('google', new GoogleProvider({ apiKey: config.googleKey, ...fetchOption }));
  }
  if (config.mock) available.set('mock', config.mock);

  return {
    get(id) {
      const provider = available.get(id);
      if (!provider) {
        throw AppError.unavailable(
          `${id} sağlayıcısı kullanılamıyor: API anahtarı tanımlı değil ya da adaptörü henüz yok`,
        );
      }
      return provider;
    },
  };
}
