import { createApp } from './app.js';
import { EnvError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createDb, pingDb, type Db } from './lib/prisma.js';
import { createProviderRegistry } from './providers/registry.js';
import { PrismaEvaluationRepository } from './repositories/prisma-evaluation.repository.js';
import { PrismaExportRepository } from './repositories/prisma-export.repository.js';
import { PrismaPromptTemplateRepository } from './repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from './repositories/prisma-provider-model.repository.js';
import { PrismaRubricRepository } from './repositories/prisma-rubric.repository.js';
import { PrismaTextLibraryRepository } from './repositories/prisma-text-library.repository.js';
import { PrismaTextRepository } from './repositories/prisma-text.repository.js';
import { createComparisonService } from './services/comparison.service.js';
import { createEvaluationService } from './services/evaluation.service.js';
import { createPromptTemplateService } from './services/prompt-template.service.js';
import { createRubricService, type RubricService } from './services/rubric.service.js';

const VERSION = process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0';
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Karşılaştır ucunun bağımlılıkları: hakem çağrısı için sağlayıcılar (anahtarlar süreç ortamından), kayıt defterleri. */
function buildComparisons(env: Env, db: Db, rubrics: RubricService) {
  const models = new PrismaProviderModelRepository(db);
  const providers = createProviderRegistry({
    anthropicKey: env.ANTHROPIC_API_KEY,
    googleKey: env.GEMINI_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    deepseekKey: env.DEEPSEEK_API_KEY,
  });
  return createComparisonService({
    texts: new PrismaTextRepository(db),
    models,
    providers,
    rubrics,
    judgeModel: env.DEFAULT_JUDGE,
    evaluation: createEvaluationService({
      evaluations: new PrismaEvaluationRepository(db),
      models,
      templates: createPromptTemplateService(new PrismaPromptTemplateRepository(db)),
      rubrics,
      providers,
    }),
  });
}

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

  const rubrics = db ? createRubricService(new PrismaRubricRepository(db)) : undefined;

  const app = createApp({
    env,
    logger,
    version: VERSION,
    checkDb: db ? () => pingDb(db) : undefined,
    rubrics,
    exports: db ? new PrismaExportRepository(db) : undefined,
    comparisons: db && rubrics ? buildComparisons(env, db, rubrics) : undefined,
    texts: db ? new PrismaTextLibraryRepository(db) : undefined,
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
