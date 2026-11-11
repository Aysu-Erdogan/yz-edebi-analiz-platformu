import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { sendError } from '../lib/http.js';

/** Tanımsız yol: HTML değil, JSON döner. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `Yol bulunamadı: ${req.method} ${req.path}`, {
    requestId: String(req.id ?? ''),
  });
};

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/**
 * Merkezi hata işleyici. İç ayrıntı (yığın izi, sağlayıcı mesajı, anahtar) istemciye gitmez,
 * yalnızca günlüğe yazılır. İstemci requestId ile günlükte eşleştirme yapabilir.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = String(req.id ?? '');

  if (res.headersSent) return;

  if (err instanceof AppError) {
    req.log?.warn({ err, code: err.code }, 'uygulama hatası');
    sendError(res, err.status, err.code, err.message, { details: err.details, requestId });
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Geçersiz istek verisi', {
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      requestId,
    });
    return;
  }

  const bodyErr = err as BodyParserError;
  if (bodyErr?.type === 'entity.parse.failed') {
    sendError(res, 400, 'BAD_JSON', 'İstek gövdesi geçerli JSON değil', { requestId });
    return;
  }
  if (bodyErr?.type === 'entity.too.large') {
    sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'İstek gövdesi çok büyük', { requestId });
    return;
  }

  req.log?.error({ err }, 'beklenmeyen hata');
  sendError(res, 500, 'INTERNAL_ERROR', 'Sunucuda beklenmeyen bir hata oluştu', { requestId });
};
