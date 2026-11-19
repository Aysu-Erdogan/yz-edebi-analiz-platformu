import type { Response } from 'express';
import type { ErrorCode } from './errors.js';

/** Tüm yanıtlar aynı zarfı kullanır: { success, data } ya da { success, error }. */
export interface SuccessBody<T> {
  success: true;
  data: T;
}

export interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
}

export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body: SuccessBody<T> = { success: true, data };
  res.status(status).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  extra: { details?: unknown; requestId?: string } = {},
): void {
  const body: ErrorBody = { success: false, error: { code, message, ...extra } };
  res.status(status).json(body);
}
