import { Router } from 'express';
import { z } from 'zod';
import { excerpt, wordCount } from '../domain/library.js';
import { GENRES } from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import { sendOk } from '../lib/http.js';
import type {
  LibraryText,
  TextLibraryRepository,
} from '../repositories/text-library.repository.js';

// Aynı parametrenin iki kez verilmesi (dizi) zod'da 400 olur.
const listQuery = z.object({
  genre: z.enum(GENRES).optional(),
  theme: z.string().trim().min(1).max(32).optional(),
  source: z.enum(['generated', 'manual']).optional(),
});
const idParam = z.coerce.number().int().positive();

/** Listede metnin gövdesi yok: özet ve sözcük sayısı (gövde ayrıntı ucundadır). */
const summarize = ({ body, ...rest }: LibraryText) => ({
  ...rest,
  wordCount: wordCount(body),
  excerpt: excerpt(body),
});

/**
 * Metin kütüphanesi okuma uçları (yalnızca okur). Yönetici girişi gelene kadar (F4) herkese açıktır: platform
 * gerçek kullanıma açılmayacak. Metin ekleme `POST /comparisons` ile yapılır, burada yazma ucu yoktur.
 */
export function createTextsRouter(library: TextLibraryRepository): Router {
  const router = Router();

  router.get('/texts', async (req, res) => {
    const filter = listQuery.parse(req.query);
    sendOk(res, (await library.list(filter)).map(summarize));
  });

  router.get('/texts/:id', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const text = await library.get(id);
    if (!text) throw AppError.notFound(`Metin bulunamadı: ${id}`);
    sendOk(res, { ...text, wordCount: wordCount(text.body) });
  });

  return router;
}
