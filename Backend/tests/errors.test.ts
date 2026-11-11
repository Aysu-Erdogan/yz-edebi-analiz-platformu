import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { AppError } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js';
import { buildTestApp } from './helpers.js';

/** Hata işleyicisini, bilinçli hata fırlatan küçük bir uygulamayla dener. */
function appThatThrows(error: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw error;
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('merkezi hata işleme', () => {
  it('T28: bozuk JSON gövdesi HTML değil, anlamlı JSON hatası döner', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"bozuk": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toMatchObject({ success: false, error: { code: 'BAD_JSON' } });
  });

  it('T23: aşırı büyük gövde 413 döner', async () => {
    const big = JSON.stringify({ metin: 'a'.repeat(300_000) });
    const res = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('bilinmeyen yol 404 ve JSON döner', async () => {
    const res = await request(buildTestApp()).get('/api/v1/yok');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('AppError kendi durum kodu ve koduyla döner', async () => {
    const res = await request(appThatThrows(AppError.forbidden())).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('T22: ZodError 500 değil 400 döner ve alan yollarını listeler', async () => {
    const parsed = z.object({ tema: z.string() }).safeParse({ tema: 5 });
    if (parsed.success) throw new Error('beklenmeyen başarı');
    const res = await request(appThatThrows(parsed.error)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('tema');
  });

  it('T26: beklenmeyen hata 500 döner ve iç ayrıntıyı (mesaj, yığın izi) sızdırmaz', async () => {
    const secret = new Error('GEMINI_API_KEY=AIza-cok-gizli bağlantı reddedildi');
    const res = await request(appThatThrows(secret)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('cok-gizli');
    expect(text).not.toContain('at ');
  });

  it('CORS: izinli kaynağa izin verir, izinsiz kaynağa başlık eklemez', async () => {
    const env = parseEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'http://izinli.test' });
    const app = createApp({ env, logger: createLogger(env) });
    const ok = await request(app).get('/api/v1/health').set('Origin', 'http://izinli.test');
    expect(ok.headers['access-control-allow-origin']).toBe('http://izinli.test');
    const denied = await request(app).get('/api/v1/health').set('Origin', 'http://kotu.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
