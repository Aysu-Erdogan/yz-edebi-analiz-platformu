import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EnvError, loadEnv } from '../src/config/env.js';
import { createDb } from '../src/lib/prisma.js';
import { PrismaExportRepository } from '../src/repositories/prisma-export.repository.js';
import { runExportCli } from '../src/services/export-cli.js';

/**
 * `npm run export -- <csv|json> --cikti <dosya>`: puanlama kayıtlarını dosyaya yazar (yalnızca okur, ücretsiz).
 * Dosyayı biz yazarız (PowerShell'in `>` yönlendirmesi Türkçe karakterleri UTF-16'ya çevirip bozar).
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new EnvError(['DATABASE_URL: zorunlu']);

  const db = createDb(env.DATABASE_URL);
  try {
    process.exitCode = await runExportCli(
      process.argv.slice(2),
      {
        exports: new PrismaExportRepository(db),
        write: (path, data) => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, data, 'utf8');
        },
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
