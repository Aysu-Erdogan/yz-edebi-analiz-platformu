import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { createProviderRegistry } from '../src/providers/registry.js';

describe('sağlayıcı seçimi', () => {
  it('anahtarı tanımlı sağlayıcıları verir', () => {
    const registry = createProviderRegistry({
      anthropicKey: 'a',
      googleKey: 'g',
      openaiKey: 'o',
      deepseekKey: 'd',
    });
    expect(registry.get('anthropic').id).toBe('anthropic');
    expect(registry.get('google').id).toBe('google');
    expect(registry.get('openai').id).toBe('openai');
    expect(registry.get('deepseek').id).toBe('deepseek');
  });

  it('verilen Mock sağlayıcıyı aynen döner', () => {
    const mock = new MockProvider();
    expect(createProviderRegistry({ mock }).get('mock')).toBe(mock);
  });

  it('anahtarı olmayan sağlayıcı sessizce başka şeye düşmez, açık hata (503) verir', () => {
    const registry = createProviderRegistry({ anthropicKey: 'a' });
    for (const id of ['google', 'openai', 'deepseek', 'mock'] as const) {
      expect(() => registry.get(id), id).toThrow(AppError);
      expect(() => registry.get(id)).toThrow(/kullanılamıyor/);
    }
    try {
      registry.get('google');
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    }
  });

  it('boş ya da yalnızca boşluktan oluşan anahtar tanımsız sayılır', () => {
    const registry = createProviderRegistry({
      anthropicKey: '',
      googleKey: '   ',
      openaiKey: '',
      deepseekKey: ' ',
    });
    for (const id of ['anthropic', 'google', 'openai', 'deepseek'] as const) {
      expect(() => registry.get(id), id).toThrow(/kullanılamıyor/);
    }
  });

  it('hata iletisi anahtar değerini içermez', () => {
    const registry = createProviderRegistry({ anthropicKey: 'sk-GIZLI' });
    try {
      registry.get('google');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('sk-GIZLI');
    }
  });
});
