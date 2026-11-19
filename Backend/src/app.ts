import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './routes/health.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  version?: string;
  /** Veritabanı sağlık kontrolü. Testlerde sahte sürüm verilir. */
  checkDb?: () => Promise<void>;
}

/** Express uygulamasını kurar (dinlemez). Böylece testler gerçek porta ihtiyaç duymaz. */
export function createApp({ env, logger, version = '0.1.0', checkDb }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      // İstemci kimliği verirse kullan, yoksa üret. Yanıt başlığında da döner.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );

  // Metin uzunluğu için ayrıca iş kuralı sınırı konacak (F1); bu genel gövde sınırıdır.
  app.use(express.json({ limit: '200kb' }));

  const api = express.Router();
  api.use(createHealthRouter({ version, checkDb }));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
