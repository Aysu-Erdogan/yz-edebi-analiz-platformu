import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertSafeTestDatabase,
  testDatabaseUrl,
  withoutDriverOptions,
} from './support/test-db.js';

const backendDir = fileURLToPath(new URL('..', import.meta.url));
const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));

/**
 * Tüm testlerden önce bir kez: test veritabanına migration'ları uygular (zaten uygulanmışsa bir şey yapmaz).
 * TEST_DATABASE_URL yoksa hiçbir şey yapmaz; MySQL testleri kendileri atlanır (CI'da hata verir).
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (!url) return;
  assertSafeTestDatabase(url);

  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: withoutDriverOptions(url) },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    const password = decodeURIComponent(new URL(url).password);
    const text = `${stdout}\n${stderr}`.trim();
    throw new Error(
      `Test veritabanına migration uygulanamadı:\n${password ? text.split(password).join('***') : text}`,
      { cause: error },
    );
  }
}
