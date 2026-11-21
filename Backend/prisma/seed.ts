import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvError, loadEnv } from '../src/config/env.js';
import { createDb } from '../src/lib/prisma.js';
import { PrismaPromptTemplateRepository } from '../src/repositories/prisma-prompt-template.repository.js';
import { PrismaRubricRepository } from '../src/repositories/prisma-rubric.repository.js';
import { seedModels } from '../src/seed/model-seed.js';
import { seedPrompts } from '../src/seed/prompt-seed.js';
import { seedRubrics } from '../src/seed/rubric-seed.js';
import { createPromptTemplateService } from '../src/services/prompt-template.service.js';
import { createRubricService } from '../src/services/rubric.service.js';

/**
 * `npm run db:seed`: taslak rubrik v0.1'i (şiir, hikâye, deneme), karşılaştırılan model listesini
 * (ADR 0010) ve üretim komut şablonunu (v1) yükler. Tekrar çalıştırılabilir, var olan kayda dokunmaz.
 */
const dir = fileURLToPath(new URL('./seed-data/rubrics/v0.1-taslak/', import.meta.url));
const modelsFile = fileURLToPath(new URL('./seed-data/models.json', import.meta.url));
const promptsDir = fileURLToPath(new URL('./seed-data/prompts/', import.meta.url));

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

    const models = await seedModels(db, JSON.parse(readFileSync(modelsFile, 'utf8')));
    console.log(`Model seed: ${models.created} yüklendi, ${models.skipped} zaten vardı.`);

    const prompts: unknown[] = readdirSync(promptsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(promptsDir, f), 'utf8')));
    const templates = await seedPrompts(
      createPromptTemplateService(new PrismaPromptTemplateRepository(db)),
      prompts,
    );
    console.log(`Şablon seed: ${templates.created} yüklendi, ${templates.skipped} zaten vardı.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
