import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvError, loadEnv } from '../src/config/env.js';
import { createDb } from '../src/lib/prisma.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { seedRubrics } from '../src/seed/rubric-seed.js';
import { createRubricService } from '../src/services/rubric.service.js';

/** `npm run db:seed`: taslak rubrik v0.1'i (şiir, hikâye, deneme) yükler. Tekrar çalıştırılabilir. */
const dir = fileURLToPath(new URL('./seed-data/rubrics/v0.1-taslak/', import.meta.url));

async function main(): Promise<void> {
  const { DATABASE_URL } = loadEnv();
  if (!DATABASE_URL) throw new EnvError(['DATABASE_URL: zorunlu']);

  const db = createDb(DATABASE_URL);
  try {
    const rubrics: unknown[] = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const result = await seedRubrics(createRubricService(new PrismaRubricRepository(db)), rubrics);
    console.log(`Rubrik seed: ${result.created} yüklendi, ${result.skipped} zaten vardı.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
