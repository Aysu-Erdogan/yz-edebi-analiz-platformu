import { pathToFileURL } from 'node:url';
import { EnvError, loadEnv } from '../src/config/env.js';
import { createDb } from '../src/lib/prisma.js';
import { createProviderRegistry } from '../src/providers/registry.js';
import { PrismaEvaluationRepository } from '../src/repositories/prisma-evaluation.repository.js';
import { PrismaGenerationRepository } from '../src/repositories/prisma-generation.repository.js';
import { PrismaJobRepository } from '../src/repositories/prisma-job.repository.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaProviderModelRepository } from '../src/repositories/prisma-provider-model.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { runBatchCli } from '../src/services/batch-cli.js';
import { createPromptTemplateService } from '../src/services/prompt-template.service.js';
import { createRubricService } from '../src/services/rubric.service.js';

/**
 * `npm run batch -- <uret|puanla|devam|durum> ...`: toplu üretim ve puanlama. Varsayılan olarak yalnızca PLAN
 * gösterir; `--calistir` ile işi ekler ve çalıştırır (GERÇEK, ÜCRETLİ çağrılar). Anahtarlar `.env`'den süreç
 * içinde okunur, ekrana yazılmaz. Kullanım özeti: komutsuz çalıştırın (`npm run batch`).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new EnvError(['DATABASE_URL: zorunlu']);

  const db = createDb(env.DATABASE_URL);
  const stop = new AbortController();
  // Ctrl+C: çalışan öğe biter, iş bekleyene döner, `devam` ile sürdürülür.
  process.once('SIGINT', () => {
    console.log('\nDurdurma istendi: çalışan öğe bitirilecek, iş bekleyene dönecek...');
    stop.abort();
  });

  try {
    process.exitCode = await runBatchCli(
      process.argv.slice(2),
      {
        jobs: new PrismaJobRepository(db),
        templates: createPromptTemplateService(new PrismaPromptTemplateRepository(db)),
        rubrics: createRubricService(new PrismaRubricRepository(db)),
        models: new PrismaProviderModelRepository(db),
        generations: new PrismaGenerationRepository(db),
        evaluations: new PrismaEvaluationRepository(db),
        providers: createProviderRegistry({
          anthropicKey: env.ANTHROPIC_API_KEY,
          googleKey: env.GEMINI_API_KEY,
          openaiKey: env.OPENAI_API_KEY,
          deepseekKey: env.DEEPSEEK_API_KEY,
        }),
      },
      console.log,
      stop.signal,
    );
  } finally {
    await db.$disconnect();
  }
}

// Yalnızca doğrudan çalıştırılınca; test dosyaları içe aktarırken çalışmaz.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Hata iletisi anahtarları ve parolayı içermez (adaptörler ve veritabanı katmanı iletiyi temiz tutar).
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
