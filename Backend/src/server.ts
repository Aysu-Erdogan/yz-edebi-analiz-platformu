import { createApp } from './app.js';
import { EnvError, loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createDb, pingDb } from './lib/prisma.js';

const VERSION = process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0';
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    // Eksik/yanlış yapılandırma: açık bir mesajla dur (anahtar değerleri yazılmaz).
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(env);
  const db = env.DATABASE_URL ? createDb(env.DATABASE_URL) : undefined;

  const app = createApp({
    env,
    logger,
    version: VERSION,
    checkDb: db ? () => pingDb(db) : undefined,
  });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, version: VERSION }, 'Backend dinlemede');
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'kapatılıyor');
    const force = setTimeout(() => {
      logger.error('zorla kapatıldı (zaman aşımı)');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    server.close(async () => {
      try {
        await db?.$disconnect();
      } finally {
        process.exit(0);
      }
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Sunucu başlatılamadı:', err);
  process.exit(1);
});
