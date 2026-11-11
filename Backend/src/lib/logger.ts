import { pino, type Logger } from 'pino';
import type { Env } from '../config/env.js';

export type { Logger };

/** JSON log. Kimlik bilgisi taşıyan başlıklar günlüğe yazılmaz. */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[gizli]',
    },
  });
}
