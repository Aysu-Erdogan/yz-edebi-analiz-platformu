import { Router } from 'express';
import { sendOk } from '../lib/http.js';
import type { ComparisonService } from '../services/comparison.service.js';

/**
 * Karşılaştır sayfasının ucu. Ücretli hakem çağrısı yapar. Yönetici girişi ve hız sınırı gelene kadar (F4)
 * herkese açıktır: platform gerçek kullanıma açılmayacak.
 */
export function createComparisonsRouter(service: ComparisonService): Router {
  const router = Router();

  router.post('/comparisons', async (req, res) => {
    sendOk(res, await service.compare(req.body));
  });

  return router;
}
