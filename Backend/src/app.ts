import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import type { ExportRepository } from './repositories/export.repository.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createComparisonsRouter } from './routes/comparisons.js';
import { createHealthRouter } from './routes/health.js';
import { createRubricsRouter } from './routes/rubrics.js';
import type { ComparisonService } from './services/comparison.service.js';
import type { RubricService } from './services/rubric.service.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  version?: string;
  /** Veritabanı sağlık kontrolü. Testlerde sahte sürüm verilir. */
  checkDb?: () => Promise<void>;
  /** Rubrik servisi. Tanımsızsa (veritabanı yok) rubrik uçları açılmaz. */
  rubrics?: RubricService;
  /** Puanlama kayıtlarını okuyan depo. Tanımsızsa analiz ve dışa aktarma uçları açılmaz. */
  exports?: ExportRepository;
  /** Karşılaştır servisi. Tanımsızsa (veritabanı yok) karşılaştırma ucu açılmaz. */
  comparisons?: ComparisonService;
}

/** Express uygulamasını kurar (dinlemez). Böylece testler gerçek porta ihtiyaç duymaz. */
export function createApp({
  env,
  logger,
  version = '0.1.0',
  checkDb,
  rubrics,
  exports,
  comparisons,
}: AppDeps): Express {
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
  if (rubrics) api.use(createRubricsRouter(rubrics));
  if (exports) api.use(createAnalyticsRouter(exports));
  if (comparisons) api.use(createComparisonsRouter(comparisons));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
