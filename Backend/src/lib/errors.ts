/** İstemciye gösterilebilen, sabit kodlu uygulama hatası. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(message: string, details?: unknown) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Kimlik doğrulaması gerekli') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'Bu işlem için yetkiniz yok') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Kayıt bulunamadı') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string) {
    return new AppError(409, 'CONFLICT', message);
  }
  static unavailable(message: string) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
}
