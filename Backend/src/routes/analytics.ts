import { Router } from 'express';
import { z } from 'zod';
import { analysisReport, analyze, filterThemes } from '../domain/analysis.js';
import { exportCsv, exportJson } from '../domain/export.js';
import { sendOk } from '../lib/http.js';
import type { ExportRepository } from '../repositories/export.repository.js';

// Aynı parametrenin iki kez verilmesi (dizi) zod'da 400 olur.
const statsQuery = z.object({ tema: z.string().optional() });
const exportQuery = z.object({ format: z.enum(['csv', 'json']) });

/**
 * Analiz ve dışa aktarma okuma uçları (yalnızca okur). Ölçüm ve istatistik alan kodundadır (`analysis.ts`),
 * burada yalnızca HTTP'ye bağlanır. Yönetici girişi gelene kadar (F4) uçlar herkese açıktır: platform
 * gerçek kullanıma açılmayacak.
 */
export function createAnalyticsRouter(
  exports: ExportRepository,
  now: () => Date = () => new Date(),
): Router {
  const router = Router();

  router.get('/analytics/stats', async (req, res) => {
    const { tema } = statsQuery.parse(req.query);
    const records = filterThemes(await exports.listEvaluations(), tema);
    sendOk(res, analysisReport(analyze(records), now()));
  });

  router.get('/export', async (req, res) => {
    const { format } = exportQuery.parse(req.query);
    const records = await exports.listEvaluations();
    res.attachment(`puanlar.${format}`);
    // csv: BOM ile (Excel Türkçe karakterleri doğru okusun), json: gerekçeler ve metinle tam kayıt.
    res
      .type(format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
      .send(format === 'csv' ? exportCsv(records, { bom: true }) : exportJson(records, now()));
  });

  return router;
}
