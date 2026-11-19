import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api';

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apiRequest', () => {
  it('başarılı zarfın data alanını döndürür', async () => {
    mockFetch(json({ success: true, data: { merhaba: 'dünya' } }));
    await expect(apiRequest('/x')).resolves.toEqual({ merhaba: 'dünya' });
  });

  it('json verildiğinde Content-Type ekler ve gövdeyi dizgeleştirir', async () => {
    const fetchMock = mockFetch(json({ success: true, data: null }));
    await apiRequest('/x', { method: 'POST', json: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('T31: ağ hatasında NETWORK_ERROR fırlatır', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const err = await apiRequest('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isNetworkError).toBe(true);
    expect((err as ApiError).status).toBe(0);
  });

  it('Safari tarzı ağ hatasını da (mesaja bakmadan) NETWORK_ERROR sayar', async () => {
    mockFetch(new TypeError('Load failed'));
    const err = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('backend hata zarfını kod, mesaj ve requestId ile yansıtır', async () => {
    mockFetch(
      json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Geçersiz', requestId: 'r-1' },
        },
        400,
      ),
    );
    const err = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Geçersiz',
      requestId: 'r-1',
    });
  });

  it('HTML hata sayfasında "body already read" hatası vermez, HTTP_ERROR döner', async () => {
    mockFetch(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.status).toBe(502);
  });

  it('200 ama JSON olmayan yanıtı INVALID_RESPONSE sayar', async () => {
    mockFetch(new Response('ok', { status: 200 }));
    const err = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('INVALID_RESPONSE');
  });
});
