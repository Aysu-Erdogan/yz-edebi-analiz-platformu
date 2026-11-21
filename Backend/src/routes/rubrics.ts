import { Router } from 'express';
import { z } from 'zod';
import { sendOk } from '../lib/http.js';
import type { RubricService } from '../services/rubric.service.js';

const idSchema = z.coerce.number().int().positive();
// Değerlerin geçerliliğini (tür, durum) servis denetler; burada yalnızca "tek bir metin" olmaları şart.
const filterSchema = z.object({ genre: z.string().optional(), status: z.string().optional() });

/**
 * Rubrik okuma uçları. Yazma uçları (içe aktarma, etkinleştirme) yönetici girişi gelene kadar
 * (F4) bilerek yok; servis bunları destekler.
 */
export function createRubricsRouter(service: RubricService): Router {
  const router = Router();

  router.get('/rubrics', async (req, res) => {
    sendOk(res, await service.listRubrics(filterSchema.parse(req.query)));
  });

  router.get('/rubrics/:id', async (req, res) => {
    sendOk(res, await service.getRubric(idSchema.parse(req.params.id)));
  });

  return router;
}
