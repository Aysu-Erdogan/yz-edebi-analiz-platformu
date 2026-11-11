import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;

/** MySQL bağlantısı (Prisma 7 sürücü adaptörü ile). Tek örnek uygulama başında oluşturulur. */
export function createDb(databaseUrl: string): Db {
  const adapter = new PrismaMariaDb(databaseUrl);
  return new PrismaClient({ adapter });
}

/** Sağlık kontrolü için basit sorgu. */
export async function pingDb(db: Db): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
