import mariadb from 'mariadb';
import { EnvError, loadEnv } from '../src/config/env.js';
import { createDb, pingDb } from '../src/lib/prisma.js';

/**
 * `npm run db:check`: DATABASE_URL ve TEST_DATABASE_URL ile veritabanına bağlanılabiliyor mu?
 * Parolayı ASLA yazmaz: yalnızca veritabanı adı, sunucu ve sonuç görünür.
 */

interface Target {
  label: string;
  url: string | undefined;
  mustEndWith?: string;
}

/** Hata metninden parolayı (ve URL kodlu halini) siler. */
function redact(text: string, password: string): string {
  if (!password) return text;
  return text.split(password).join('***').split(encodeURIComponent(password)).join('***');
}

interface DbError {
  errno?: number;
  code?: string;
  message?: string;
}

/** En yaygın bağlantı sorunları için kısa Türkçe ipucu. */
function hintFor({ errno, code, message = '' }: DbError): string {
  if (errno === 1045)
    return 'kullanıcı adı ya da parola yanlış (.env içindeki parolayı kontrol edin)';
  if (errno === 1049) return 'bu adda veritabanı yok (CREATE DATABASE komutunu çalıştırdınız mı?)';
  if (errno === 1044)
    return 'kullanıcının bu veritabanında yetkisi yok (GRANT komutunu çalıştırdınız mı?)';
  if (errno === 45044 || /RSA public key/i.test(message)) {
    return 'parola doğru, ama MySQL 8 anahtar alışverişi için izin istiyor: .env adresinin SONUNA ?allowPublicKeyRetrieval=true ekleyin (yalnızca kendi bilgisayarınızdaki localhost için)';
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ER_CONNECTION_TIMEOUT') {
    return 'sunucuya ulaşılamadı (MySQL çalışıyor mu? adres ve port doğru mu?)';
  }
  return 'bu çıktıyı bana iletin';
}

/**
 * Prisma'nın bağlantı havuzu her hatayı "45028 pool failed" diye saklar. Gerçek nedeni görmek
 * için aynı bilgilerle havuzsuz, doğrudan tek bir bağlantı denenir.
 */
async function diagnose(parsed: URL, password: string): Promise<{ reason: string; hint: string }> {
  try {
    const connection = await mariadb.createConnection({
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password,
      database: parsed.pathname.replace(/^\//, ''),
      connectTimeout: 4000,
      // Adresteki seçenek, Prisma bağlantısındaki gibi sürücüye aynen geçer.
      allowPublicKeyRetrieval: parsed.searchParams.get('allowPublicKeyRetrieval') === 'true',
    });
    await connection.end();
    return {
      reason: 'doğrudan bağlantı başarılı (kimlik bilgileri doğru)',
      hint: 'sorun Prisma bağlantı havuzunda, bu çıktıyı bana iletin',
    };
  } catch (error) {
    const err = error as DbError;
    const firstLine =
      redact(String(err.message ?? ''), password)
        .split('\n')
        .find((l) => l.trim()) ?? 'bilinmeyen hata';
    return {
      reason: `${err.errno ?? '?'} ${err.code ?? ''}: ${firstLine.trim().slice(0, 240)}`,
      hint: hintFor(err),
    };
  }
}

async function check({ label, url, mustEndWith }: Target): Promise<boolean> {
  const name = `${label}:`.padEnd(20);
  if (!url) {
    console.log(`${name} tanımlı değil (.env içinde ${label} satırı yok ya da boş)`);
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.log(`${name} biçimi geçersiz (mysql://kullanici:parola@localhost:3306/ad olmalı)`);
    return false;
  }
  const database = parsed.pathname.replace(/^\//, '');
  const where = `${database || '(ad yok)'} @ ${parsed.hostname}:${parsed.port || '3306'}`;
  const password = decodeURIComponent(parsed.password);

  if (mustEndWith && !database.endsWith(mustEndWith)) {
    console.log(
      `${name} ${where}: REDDEDİLDİ, veritabanı adı "${mustEndWith}" ile bitmeli (gerçek veriyi korumak için)`,
    );
    return false;
  }

  const db = createDb(url);
  try {
    await pingDb(db);
    const rows = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`;
    const tables = Number(rows[0]?.n ?? 0);
    console.log(`${name} ${where}: bağlandı, ${tables} tablo`);
    return true;
  } catch {
    const { reason, hint } = await diagnose(parsed, password);
    console.log(`${name} ${where}: BAĞLANAMADI`);
    console.log(`${' '.repeat(21)}neden: ${reason}`);
    console.log(`${' '.repeat(21)}ipucu: ${hint}`);
    return false;
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    loadEnv(); // kökteki .env dosyasını yükler (süreç ortamına, ekrana değil)
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    // DATABASE_URL eksikse aşağıdaki kontrol bunu zaten açıkça söyler.
  }

  const results = [
    await check({ label: 'DATABASE_URL', url: process.env.DATABASE_URL }),
    await check({
      label: 'TEST_DATABASE_URL',
      url: process.env.TEST_DATABASE_URL,
      mustEndWith: '_test',
    }),
  ];
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

void main();
