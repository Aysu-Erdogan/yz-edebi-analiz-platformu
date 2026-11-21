import { describe, expect, it } from 'vitest';
import { smoke } from '../scripts/llm-smoke.js';
import { MockProvider } from '../src/providers/mock-provider.js';
import { ProviderError, type GenerateRequest } from '../src/providers/provider.js';

/** Metin isteğine "selam", JSON isteğine şemaya uyan cevap verir. */
const happy = (req: GenerateRequest) => ('schema' in req ? '{"cevap":"selam"}' : 'selam');

async function run(targets: Parameters<typeof smoke>[0]) {
  const lines: string[] = [];
  const ok = await smoke(targets, (line) => lines.push(line));
  return { ok, output: lines.join('\n') };
}

describe('llm:smoke (gerçek servis denemesi)', () => {
  it('çalışan sağlayıcı için metin ve JSON denemesini ✔ ile gösterir, maliyeti hesaplar, anahtarı yazmaz', async () => {
    const { ok, output } = await run([
      {
        label: 'Claude',
        provider: new MockProvider({ respond: happy }),
        model: 'claude-haiku-5-5',
        secret: 'sk-GIZLI-ANAHTAR',
        price: [0.1, 0.5],
      },
    ]);
    expect(ok).toBe(true);
    expect(output.match(/✔/g)).toHaveLength(2); // metin ve JSON
    expect(output).toContain('Claude');
    expect(output).toContain('claude-haiku-5-5');
    expect(output).toContain('≈ $');
    expect(output).not.toContain('sk-GIZLI-ANAHTAR');
  });

  it('hata durumunda ✖, hata türü ve ipucu gösterir; hata iletisindeki anahtarı gizler', async () => {
    const failing = new MockProvider({
      respond: () => {
        throw new ProviderError('auth', 'HTTP 401: anahtar sk-GIZLI-ANAHTAR geçersiz');
      },
    });
    const { ok, output } = await run([
      { label: 'Gemini', provider: failing, model: 'gemini-x', secret: 'sk-GIZLI-ANAHTAR' },
    ]);
    expect(ok).toBe(false);
    expect(output).toContain('✖');
    expect(output).toContain('auth');
    expect(output).toContain('kalıcı');
    expect(output).toContain('anahtar'); // ipucu
    expect(output).toContain('***');
    expect(output).not.toContain('sk-GIZLI-ANAHTAR');
  });

  it('fiyatı bilinmeyen modelde maliyet yazmaz ama çalışır; biri başarısız olunca genel sonuç başarısız', async () => {
    const { ok, output } = await run([
      {
        label: 'Claude',
        provider: new MockProvider({ respond: happy }),
        model: 'yeni-model',
        secret: 'a',
      },
      {
        label: 'Gemini',
        provider: new MockProvider({
          respond: () => {
            throw new ProviderError('rate_limit', 'HTTP 429: kota');
          },
        }),
        model: 'gemini-x',
        secret: 'b',
      },
    ]);
    expect(ok).toBe(false);
    expect(output).not.toContain('≈ $');
    expect(output).toContain('geçici');
  });

  it('hiç sağlayıcı yoksa (anahtar tanımsız) başarısız döner ve anahtar uyarısı verir', async () => {
    const { ok, output } = await run([]);
    expect(ok).toBe(false);
    expect(output).toContain('anahtar');
  });
});
