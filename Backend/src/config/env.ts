import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Boş dizeyi "tanımsız" sayar (`.env` içinde `KEY=` bırakılmış olabilir). */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Virgülle ayrılmış izinli tarayıcı kaynakları. */
    CORS_ORIGINS: z.string().default('http://localhost:5173').transform(csv),
    DATABASE_URL: optionalString,
    // Sağlayıcı anahtarları isteğe bağlıdır: tanımsız sağlayıcı devre dışı sayılır (F1).
    GEMINI_API_KEY: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'test' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'zorunlu (örn. mysql://kullanici:parola@localhost:3306/yz_edebi)',
      });
    }
    if (env.DATABASE_URL && !env.DATABASE_URL.startsWith('mysql://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'mysql:// ile başlamalı',
      });
    }
  });

export type Env = z.infer<typeof schema>;

/** Ortam değişkenlerini doğrular. Hata mesajı değer içermez, yalnızca alan adlarını ve nedenini söyler. */
export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Geçersiz ortam yapılandırması:\n - ${problems.join('\n - ')}`);
    this.name = 'EnvError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `${i.path.join('.') || '(genel)'}: ${i.message}`,
    );
    throw new EnvError(problems);
  }
  return result.data;
}

/** Depo kökündeki `.env` dosyasını (varsa) yükler, sonra doğrular. Gerçek ortam değişkenleri önceliklidir. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const envFile = resolve(process.cwd(), '..', '.env');
  if (source === process.env && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  return parseEnv(source);
}
