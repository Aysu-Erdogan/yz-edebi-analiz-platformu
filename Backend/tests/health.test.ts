import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('GET /api/v1/health', () => {
  it('veritabanı yapılandırılmamışsa 200 ve "unconfigured" döner', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      status: 'ok',
      version: 'test',
      checks: { database: 'unconfigured' },
    });
  });

  it('veritabanı yanıt veriyorsa "up" döner', async () => {
    const app = buildTestApp({ checkDb: async () => {} });
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.checks.database).toBe('up');
  });

  it('veritabanı hatasında 503 döner ve hata ayrıntısını sızdırmaz', async () => {
    const app = buildTestApp({
      checkDb: async () => {
        throw new Error('Access denied for user root@localhost (using password: YES) cok-gizli');
      },
    });
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('cok-gizli');
  });

  it('yanıt başlığında X-Request-Id bulunur ve istemci kimliği korunur', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
    const generated = await request(buildTestApp()).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('güvenlik başlıklarını ekler ve x-powered-by göstermez', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
