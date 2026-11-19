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
      vi.fn(() => Promise.resolve(health())),
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
