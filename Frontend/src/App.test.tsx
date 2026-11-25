import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { createQueryClient } from './lib/query-client';

function renderApp(path = '/') {
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

const health = (database: 'up' | 'down' | 'unconfigured' = 'up') =>
  new Response(
    JSON.stringify({
      success: true,
      data: { status: 'ok', version: '1.2.3', uptimeSeconds: 5, checks: { database } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('App', () => {
  it('ana sayfada başlık, menü ve ana içerik alanını gösterir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(health())),
    );
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Karşılaştır' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Ana menü' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(await screen.findByText(/Sunucu çalışıyor · v1\.2\.3/)).toBeInTheDocument();
  });

  it('menüden başka sayfaya geçilebilir ve geçerli sayfa işaretlenir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('/analytics/stats')
            ? new Response(
                JSON.stringify({ success: true, data: { olusturulma: '', kosullar: [] } }),
              )
            : url.includes('/rubrics')
              ? new Response(JSON.stringify({ success: true, data: [] }))
              : health(),
        ),
      ),
    );
    renderApp();
    await userEvent.click(screen.getByRole('link', { name: 'Sonuçlar ve Analiz' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sonuçlar ve Analiz' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sonuçlar ve Analiz' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('her sayfanın kendi başlığı vardır (WCAG 2.4.2) ve sayfa değişince başlık güncellenir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('/analytics/stats')
            ? new Response(
                JSON.stringify({ success: true, data: { olusturulma: '', kosullar: [] } }),
              )
            : url.includes('/rubrics')
              ? new Response(JSON.stringify({ success: true, data: [] }))
              : health(),
        ),
      ),
    );
    renderApp();
    expect(document.title).toBe('Karşılaştır · YZ Edebi Analiz');
    await userEvent.click(screen.getByRole('link', { name: 'Rubrik ve Hakkında' }));
    expect(document.title).toBe('Rubrik ve Hakkında · YZ Edebi Analiz');
    await userEvent.click(screen.getByRole('link', { name: 'Sonuçlar ve Analiz' }));
    expect(document.title).toBe('Sonuçlar ve Analiz · YZ Edebi Analiz');
  });

  it('alt sayfa üst sayfanın başlığını alır; bilinmeyen adres "Sayfa bulunamadı" başlığı alır', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(health())),
    );
    const { unmount } = renderApp('/uretim/abc');
    expect(document.title).toBe('Üretim ve Kütüphane · YZ Edebi Analiz');
    unmount();
    renderApp('/yok-boyle-bir-sayfa');
    expect(document.title).toBe('Sayfa bulunamadı · YZ Edebi Analiz');
  });

  it('sayfa değişince odak içeriğe (main) taşınır; ilk açılışta odak çalınmaz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(health())),
    );
    renderApp();
    expect(screen.getByRole('main')).not.toHaveFocus();
    await userEvent.click(screen.getByRole('link', { name: 'Üretim ve Kütüphane' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('bilinmeyen adreste "Sayfa bulunamadı" gösterir', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(health())),
    );
    renderApp('/yok-boyle-bir-sayfa');
    expect(screen.getByRole('heading', { name: 'Sayfa bulunamadı' })).toBeInTheDocument();
  });

  it('T31: backend kapalıyken anlaşılır bir bağlantı hatası gösterir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderApp();
    expect(await screen.findByText('Sunucuya ulaşılamıyor')).toBeInTheDocument();
  });

  it('veritabanı yapılandırılmamışsa bunu belirtir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(health('unconfigured'))),
    );
    renderApp();
    expect(await screen.findByText(/veritabanı yapılandırılmamış/)).toBeInTheDocument();
  });

  it('"İçeriğe geç" bağlantısı ana içeriğe işaret eder (erişilebilirlik)', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(health())),
    );
    renderApp();
    expect(screen.getByRole('link', { name: 'İçeriğe geç' })).toHaveAttribute('href', '#icerik');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'icerik');
  });
});
