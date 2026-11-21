import { describe, expect, it } from 'vitest';
import { errorFromStatus, retryAfterMs } from '../src/providers/http-errors.js';

describe('HTTP durum kodundan sağlayıcı hatası', () => {
  const cases: [number, string, boolean][] = [
    [429, 'rate_limit', true],
    [408, 'timeout', true],
    [504, 'timeout', true],
    [500, 'server_error', true],
    [503, 'server_error', true],
    [529, 'server_error', true], // Anthropic "aşırı yüklü"
    [401, 'auth', false],
    [402, 'auth', false], // bakiye bitti: tekrar denemek işe yaramaz
    [403, 'auth', false],
    [400, 'invalid_request', false],
    [404, 'invalid_request', false],
    [413, 'invalid_request', false],
    [422, 'invalid_request', false],
  ];

  it.each(cases)('%i → %s (yeniden denenebilir: %s)', (status, kind, retryable) => {
    const error = errorFromStatus(status, 'ileti');
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toContain(String(status));
    expect(error.message).toContain('ileti');
  });

  it('Retry-After saniye cinsinden gelirse milisaniyeye çevrilir', () => {
    expect(errorFromStatus(429, 'x', new Headers({ 'retry-after': '7' })).retryAfterMs).toBe(7000);
  });
});

describe('retryAfterMs', () => {
  it('retry-after-ms (milisaniye) öncelikli, sonra retry-after (saniye)', () => {
    expect(retryAfterMs(new Headers({ 'retry-after-ms': '1500', 'retry-after': '9' }))).toBe(1500);
    expect(retryAfterMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
    expect(retryAfterMs(new Headers({ 'retry-after': '0.5' }))).toBe(500);
  });

  it('başlık yoksa, sayı değilse (tarih biçimi) ya da negatifse tanımsız döner', () => {
    expect(retryAfterMs(undefined)).toBeUndefined();
    expect(retryAfterMs(new Headers())).toBeUndefined();
    expect(
      retryAfterMs(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })),
    ).toBeUndefined();
    expect(retryAfterMs(new Headers({ 'retry-after': '-5' }))).toBeUndefined();
  });
});
