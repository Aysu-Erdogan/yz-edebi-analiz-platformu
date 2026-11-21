import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 .env dosyasını kendiliğinden yüklemez: kök .env varsa yüklenir (gerçek ortam değişkeni önceliklidir).
const envFile = resolve(process.cwd(), '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// DATABASE_URL: mysql://kullanici:parola@localhost:3306/yz_edebi
// `prisma generate` bağlantı gerektirmez, bu yüzden yoksa boş dizeyle devam edilir.
// Migration komutları (migrate deploy/dev) gerçek bir adres ister.
const raw = process.env.DATABASE_URL;
let url = '';
if (raw) {
  // allowPublicKeyRetrieval uygulamanın MariaDB sürücüsünün seçeneğidir, Prisma CLI'sine verilmez.
  const parsed = new URL(raw);
  parsed.searchParams.delete('allowPublicKeyRetrieval');
  url = parsed.toString();
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
