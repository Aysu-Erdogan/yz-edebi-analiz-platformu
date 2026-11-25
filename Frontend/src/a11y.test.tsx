import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createQueryClient } from './lib/query-client';
import { envelope, report } from './test/analytics-fixture';
import { expectNoA11yViolations } from './test/axe';
import { threeItems } from './test/compare-fixture';
import { detail, texts } from './test/library-fixture';
// Tam rubrik (düzeyleriyle): Rubrik sayfası bunu okur, Analiz sayfası yalnızca kriter adlarını.
import { rubrics } from './test/rubric-fixture';

// Chart.js canvas'a çizer, jsdom'da çizemez: etiketli bir kutuyla değiştirilir (grafik özeti gerçek bileşendeki gibi).
vi.mock('./features/analytics/ChartCanvas', () => ({
  ChartCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

type Mode = 'ok' | 'down';

/** Tüm uçlar için sahte API: gerçek ağ yok. `down`: sunucu hata verir (hata görünümleri için). */
function stubApi(mode: Mode = 'ok', over: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = Object.keys(over).find((key) => url.includes(key));
      if (route) return Promise.resolve(over[route]!());
      if (mode === 'down') return Promise.reject(new TypeError('Failed to fetch'));
      if (url.includes('/comparisons') && init?.method === 'POST')
        return Promise.resolve(envelope(threeItems));
      if (url.includes('/analytics/stats')) return Promise.resolve(envelope(report));
      if (url.includes('/rubrics')) return Promise.resolve(envelope(rubrics));
      if (/\/texts\/\d+/.test(url)) return Promise.resolve(envelope(detail()));
      if (url.includes('/texts')) return Promise.resolve(envelope(texts));
      return Promise.resolve(
        envelope({ status: 'ok', version: '1', uptimeSeconds: 1, checks: { database: 'up' } }),
      );
    }),
  );
}

function renderApp(path: string) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // index.html'deki <html lang="tr"> testte yok: sayfa düzeyindeki dil kuralı için aynısı verilir.
  document.documentElement.lang = 'tr';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

async function fillCompare(a = 'Yaprak düşer.', b = 'Rüzgâr eser.') {
  await userEvent.type(screen.getByLabelText('Metin A içeriği'), a);
  if (b) await userEvent.type(screen.getByLabelText('Metin B içeriği'), b);
}

describe('erişilebilirlik (axe-core): tüm sayfalar ve durumlar, tam uygulama (Layout dahil)', () => {
  it('Karşılaştır: boş form', async () => {
    stubApi();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Karşılaştır' });
    await expectNoA11yViolations();
  });

  it('Karşılaştır: doğrulama hatası (alanlara bağlı)', async () => {
    stubApi();
    renderApp('/');
    await fillCompare('tek metin', '');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    await screen.findByRole('alert');
    await expectNoA11yViolations();
  });

  it('Karşılaştır: sonuç (kart, kriter tablosu, gerekçeler)', async () => {
    stubApi();
    renderApp('/');
    await fillCompare();
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    await screen.findByRole('heading', { name: 'Sonuç' });
    await expectNoA11yViolations();
  });

  it('Karşılaştır: sunucu hatası', async () => {
    stubApi('ok', { '/comparisons': () => new Response('{}', { status: 500 }) });
    renderApp('/');
    await fillCompare();
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    await screen.findByText(/Karşılaştırma yapılamadı/);
    await expectNoA11yViolations();
  });

  it('Üretim ve Kütüphane: liste', async () => {
    stubApi();
    renderApp('/uretim');
    await screen.findByRole('table', { name: 'Metin kütüphanesi' });
    await expectNoA11yViolations();
  });

  it('Üretim ve Kütüphane: boş durum ve hata', async () => {
    stubApi('ok', { '/texts': () => envelope([]) });
    const { unmount } = renderApp('/uretim');
    await screen.findByText(/Henüz metin yok/);
    await expectNoA11yViolations();
    unmount();

    stubApi('down');
    renderApp('/uretim');
    await screen.findByText(/Metinler alınamadı/);
    await expectNoA11yViolations();
  });

  it('Metin ayrıntısı: puanlamalarla, bulunamadı ve geçersiz kimlik', async () => {
    stubApi();
    const first = renderApp('/uretim/5');
    await screen.findByRole('heading', { name: 'Metin #5' });
    await expectNoA11yViolations();
    first.unmount();

    stubApi('ok', {
      '/texts/9': () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Metin bulunamadı: 9' },
          }),
          { status: 404 },
        ),
    });
    const second = renderApp('/uretim/9');
    await screen.findByRole('heading', { name: 'Metin bulunamadı' });
    await expectNoA11yViolations();
    second.unmount();

    renderApp('/uretim/abc');
    await screen.findByRole('heading', { name: 'Geçersiz metin kimliği' });
    await expectNoA11yViolations();
  });

  it('Sonuçlar ve Analiz: veriyle (ısı tablosu, grafikler, istatistik tabloları)', async () => {
    stubApi();
    renderApp('/analiz');
    await screen.findByRole('table', { name: 'Model ve türe göre ortalama puan' });
    await expectNoA11yViolations();
  });

  it('Sonuçlar ve Analiz: boş durum ve hata', async () => {
    stubApi('ok', { '/analytics/stats': () => envelope({ olusturulma: '', kosullar: [] }) });
    const { unmount } = renderApp('/analiz');
    await screen.findByText('Gösterilecek puanlama yok');
    await expectNoA11yViolations();
    unmount();

    stubApi('down');
    renderApp('/analiz');
    await screen.findByText(/Sonuçlar alınamadı/);
    await expectNoA11yViolations();
  });

  it('Rubrik ve Hakkında: rubrik ve hakkında bölümü, tür değişince', async () => {
    stubApi();
    renderApp('/rubrik');
    await screen.findByRole('heading', { name: /Şiir rubriği/ });
    await expectNoA11yViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Hikâye' }));
    await expectNoA11yViolations();
  });

  it('404 sayfası', async () => {
    stubApi();
    renderApp('/yok-boyle-bir-sayfa');
    await screen.findByRole('heading', { name: 'Sayfa bulunamadı' });
    await expectNoA11yViolations();
  });

  it('denetimin kendisi çalışıyor: bilerek bozuk bir sayfada ihlal yakalar', async () => {
    // Kendini sınama: axe hiçbir şey yakalamıyorsa yukarıdaki geçişler anlamsızdır.
    const { container } = render(
      <main>
        <img src="x.png" />
        <button />
        <input />
      </main>,
    );
    await expect(expectNoA11yViolations(container)).rejects.toThrow(/image-alt|button-name|label/);
  });
});
