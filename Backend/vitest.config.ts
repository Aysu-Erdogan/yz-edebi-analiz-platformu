import { defineConfig } from 'vitest/config';
import { loadTestDatabaseUrlFromDotenv } from './tests/support/test-db.js';

// Yerelde .env'den yalnızca TEST_DATABASE_URL alınır; CI'da gerçek ortam değişkeni zaten vardır.
loadTestDatabaseUrlFromDotenv();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 20_000,
    // MySQL testleri aynı test veritabanını ve aynı tabloları kullanır: dosyalar sırayla çalışır.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/server.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
