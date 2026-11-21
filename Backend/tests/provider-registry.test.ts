import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { createProviderRegistry } from '../src/providers/registry.js';

describe('sağlayıcı seçimi', () => {
  it('anahtarı tanımlı sağlayıcıları verir', () => {
    const registry = createProviderRegistry({ anthropicKey: 'a', googleKey: 'g' });
    expect(registry.get('anthropic').id).toBe('anthropic');
    expect(registry.get('google').id).toBe('google');
  });

  it('verilen Mock sağlayıcıyı aynen döner', () => {
    const mock = new MockProvider();
    expect(createProviderRegistry({ mock }).get('mock')).toBe(mock);
  });

  it('anahtarı olmayan sağlayıcı sessizce başka şeye düşmez, açık hata (503) verir', () => {
    const registry = createProviderRegistry({ anthropicKey: 'a' });
    for (const id of ['google', 'mock'] as const) {
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
    const registry = createProviderRegistry({ anthropicKey: '', googleKey: '   ' });
    expect(() => registry.get('anthropic')).toThrow(/kullanılamıyor/);
    expect(() => registry.get('google')).toThrow(/kullanılamıyor/);
  });

  it('OpenAI adaptörü henüz yok: anahtar olsa bile kullanılamaz', () => {
    expect(() => createProviderRegistry({ anthropicKey: 'a' }).get('openai')).toThrow(
      /kullanılamıyor/,
    );
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
