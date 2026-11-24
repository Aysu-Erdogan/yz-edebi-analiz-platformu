import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EnvError, loadEnv } from '../src/config/env.js';
import { createDb } from '../src/lib/prisma.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { runRubricCli } from '../src/services/rubric-cli.js';
import { createRubricService } from '../src/services/rubric.service.js';

/** `npm run rubric -- listele | yukle <dosya>... [--etkinlestir]`: rubrik yönetimi (gerçek rubrik geldiğinde kullanılır). */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new EnvError(['DATABASE_URL: zorunlu']);

  const db = createDb(env.DATABASE_URL);
  try {
    process.exitCode = await runRubricCli(
      process.argv.slice(2),
      {
        rubrics: createRubricService(new PrismaRubricRepository(db)),
        read: (path) => readFileSync(path, 'utf8'),
      },
      console.log,
    );
  } finally {
    await db.$disconnect();
  }
}

// Yalnızca doğrudan çalıştırılınca; test dosyaları içe aktarırken çalışmaz.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
