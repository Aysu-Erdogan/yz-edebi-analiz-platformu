import { defineConfig } from 'prisma/config';

// DATABASE_URL: mysql://kullanici:parola@localhost:3306/yz_edebi
// `prisma generate` bağlantı gerektirmez, bu yüzden yoksa boş dizeyle devam edilir.
// Migration komutları (migrate deploy/dev) gerçek bir adres ister.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
