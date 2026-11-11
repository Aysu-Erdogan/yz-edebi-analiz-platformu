import { Router } from 'express';
import { sendError, sendOk } from '../lib/http.js';

export interface HealthDeps {
  version: string;
  /** Veritabanına ulaşılamıyorsa hata fırlatır. Tanımsızsa "yapılandırılmadı" sayılır. */
  checkDb?: () => Promise<void>;
}

type DbState = 'up' | 'down' | 'unconfigured';

/** GET /health: süreç ayakta mı, veritabanı yanıt veriyor mu? */
export function createHealthRouter({ version, checkDb }: HealthDeps): Router {
  const router = Router();

  router.get('/health', async (req, res) => {
    let database: DbState = 'unconfigured';
    if (checkDb) {
      try {
        await checkDb();
        database = 'up';
      } catch (err) {
        req.log?.error({ err }, 'veritabanı sağlık kontrolü başarısız');
        database = 'down';
      }
    }

    const data = {
      status: database === 'down' ? 'degraded' : 'ok',
      version,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database },
    } as const;

    if (database === 'down') {
      sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Veritabanına ulaşılamıyor', {
        details: data,
        requestId: String(req.id ?? ''),
      });
      return;
    }
    sendOk(res, data);
  });

  return router;
}
