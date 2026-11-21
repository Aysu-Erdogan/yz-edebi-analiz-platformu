import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Testler yalnızca adı _test ya da _ci ile biten veritabanında çalışır: tabloları temizlerler. */
const SAFE_DATABASE_NAME = /_(test|ci)$/;

/** TEST_DATABASE_URL, boşsa tanımsız sayılır. */
export function testDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL?.trim();
  return value ? value : undefined;
}

/** Güvenli değilse (gerçek veritabanı olabilir) hata fırlatır, aksi hâlde veritabanı adını döner. */
export function assertSafeTestDatabase(url: string): string {
  let database: string;
  try {
    database = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(
      'TEST_DATABASE_URL geçerli bir adres değil (mysql://kullanici:parola@host:3306/ad)',
    );
  }
  if (!SAFE_DATABASE_NAME.test(database)) {
    throw new Error(
      `Test veritabanı adı "_test" ya da "_ci" ile bitmeli (gelen: "${database}"). ` +
        'Testler tabloları temizler; gerçek verinizi korumak için çalışmayı reddediyorum.',
    );
  }
  return database;
}

/** Yalnızca sürücünün bildiği seçenekleri (örn. allowPublicKeyRetrieval) Prisma CLI'sine vermemek için siler. */
export function withoutDriverOptions(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('allowPublicKeyRetrieval');
  return parsed.toString();
}

/**
 * Depo kökündeki .env dosyasından YALNIZCA TEST_DATABASE_URL satırını okur (gerçek ortam değişkeni
 * önceliklidir). Testlerin sağlayıcı anahtarlarını görmesine gerek yok, bu yüzden dosyanın tamamı yüklenmez.
 */
export function loadTestDatabaseUrlFromDotenv(
  envFile = resolve(process.cwd(), '..', '.env'),
): void {
  // Değişken tanımlıysa (boş bile olsa) .env'ye bakılmaz: `TEST_DATABASE_URL= npm test` MySQL testlerini kapatır.
  if (process.env.TEST_DATABASE_URL !== undefined || !existsSync(envFile)) return;
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*TEST_DATABASE_URL\s*=/.test(l));
  if (!line) return;
  const value = line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  if (value) process.env.TEST_DATABASE_URL = value;
}
