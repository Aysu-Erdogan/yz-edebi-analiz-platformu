import { createApp, type AppDeps } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';

/** Testlerde kullanılan, gerçek bağlantı gerektirmeyen uygulama. */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const env = parseEnv({ NODE_ENV: 'test' });
  return createApp({ env, logger: createLogger(env), version: 'test', ...overrides });
}
