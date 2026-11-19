import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/config/env.js';

describe('parseEnv (T27: eksik yapılandırmada açık hata)', () => {
  it('varsayılan değerlerle test ortamını kabul eder', () => {
    const env = parseEnv({ NODE_ENV: 'test' });
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('üretimde DATABASE_URL yoksa EnvError fırlatır ve alan adını söyler', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
    try {
      parseEnv({ NODE_ENV: 'production' });
    } catch (err) {
      expect((err as EnvError).problems.join(' ')).toContain('DATABASE_URL');
    }
  });

  it('mysql:// dışındaki adresi reddeder', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x:y@localhost/db' }),
    ).toThrow(/mysql:\/\//);
  });

  it('geçerli MySQL adresini kabul eder', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'mysql://kullanici:parola@localhost:3306/yz_edebi',
    });
    expect(env.DATABASE_URL).toContain('mysql://');
  });

  it('boş bırakılmış anahtarı tanımsız sayar', () => {
    const env = parseEnv({ NODE_ENV: 'test', OPENAI_API_KEY: '   ', GEMINI_API_KEY: '' });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('CORS kaynaklarını virgülle ayırır', () => {
    const env = parseEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'http://a.test, http://b.test ,' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('geçersiz PORT değerini reddeder', () => {
    expect(() => parseEnv({ NODE_ENV: 'test', PORT: '99999' })).toThrow(EnvError);
  });

  it('hata mesajı değer sızdırmaz', () => {
    try {
      parseEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u:cok-gizli-parola@h/db' });
    } catch (err) {
      expect((err as Error).message).not.toContain('cok-gizli-parola');
    }
  });
});
