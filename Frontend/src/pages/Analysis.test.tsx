import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { envelope, report, rubrics } from '../test/analytics-fixture';
import { Analysis } from './Analysis';

// Chart.js canvas'a çizer, jsdom'da çizemez: grafiği etiketli bir kutuyla değiştiriyoruz.
// Grafiğin kendi yapılandırması charts.test.ts'te sınanır.
vi.mock('../features/analytics/ChartCanvas', () => ({
  ChartCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

type Handler = () => Response | Promise<Response>;

function mockApi(routes: { stats?: Handler; rubrics?: Handler }) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/analytics/stats')) return Promise.resolve(routes.stats!());
    if (url.includes('/rubrics')) return Promise.resolve(routes.rubrics?.() ?? envelope(rubrics));
    return Promise.reject(new Error(`beklenmeyen istek: ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const statsUrls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url).filter((u) => u.includes('/analytics/stats'));

function renderPage() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Analysis />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('Analysis sayfası', () => {
  it('başlık hemen görünür; yüklenirken durum bildirilir', () => {
    mockApi({ stats: () => envelope(report) });
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sonuçlar ve Analiz' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sonuçlar yükleniyor');
  });

  it('puan tablosunu, özet kartlarını ve taslak rubrik uyarısını gösterir', async () => {
    mockApi({ stats: () => envelope(report) });
    renderPage();
    const table = await screen.findByRole('table', { name: 'Model ve türe göre ortalama puan' });
    // 80,0 ve 40,0 tr-TR ondalık virgülüyle; eksik hücre "veri yok".
    expect(within(table).getByText('80,0')).toBeInTheDocument();
    expect(within(table).getByText('40,0')).toBeInTheDocument();
    expect(within(table).getByLabelText('veri yok')).toBeInTheDocument();
    expect(screen.getByText(/Taslak rubrik \(0\.1-taslak\)/)).toBeInTheDocument();
    expect(screen.getByText('deepseek-flash')).toBeInTheDocument();
  });

  it('grafiklerin ekran okuyucu özeti ve aynı veriyi gösteren tablosu vardır', async () => {
    mockApi({ stats: () => envelope(report) });
    renderPage();
    expect(await screen.findByRole('img', { name: /Gruplu çubuk grafik/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Radar grafik, Şiir/ })).toBeInTheDocument();
    // Radar tablosu kapalı <details> içinde; kriter adları rubrikten gelir.
    const radarTable = screen.getByRole('table', {
      name: /kriter başına ortalama ham puan/,
      hidden: true,
    });
    expect(
      within(radarTable).getByRole('columnheader', { name: 'İmge gücü', hidden: true }),
    ).toBeInTheDocument();
  });

  it('rubrik alınamazsa sayfa yine çalışır, kriterler anahtarlarıyla görünür', async () => {
    mockApi({
      stats: () => envelope(report),
      rubrics: () => new Response('{}', { status: 500 }),
    });
    renderPage();
    const radarTable = await screen.findByRole('table', { name: /kriter başına/, hidden: true });
    expect(
      within(radarTable).getByRole('columnheader', { name: 'imge', hidden: true }),
    ).toBeInTheDocument();
  });

  it('istatistik: Kruskal-Wallis ve ikili sonuçları ham değerle yazar, "anlamlı" demez', async () => {
    mockApi({ stats: () => envelope(report) });
    renderPage();
    expect(await screen.findByText(/H = 3,86/)).toBeInTheDocument();
    expect(screen.getByText(/ε² = 0,64/)).toBeInTheDocument();
    const pairs = screen.getByRole('table', { name: /ikili karşılaştırmalar/ });
    expect(within(pairs).getByText('claude-a ↔ gemini-b')).toBeInTheDocument();
    // Ham p ve Holm düzeltmeli p ayrı sütunlardır; karışmamalı.
    expect(within(pairs).getByText('0,1000')).toBeInTheDocument();
    expect(within(pairs).getByText('0,2000')).toBeInTheDocument();
    expect(within(pairs).getByText('tam')).toBeInTheDocument();
    expect(screen.getByText(/Grup başına 5 metinden az/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/anlamlı fark|istatistiksel olarak anlamlı/i);
  });

  it('tek metinli grupta standart sapma "-" görünür ("null" ya da "NaN" yazılmaz)', async () => {
    const cond = structuredClone(report.kosullar[0]!);
    cond.karsilastirmalar[0]!.gruplar[0]!.sd = null;
    mockApi({ stats: () => envelope({ ...report, kosullar: [cond] }) });
    renderPage();
    const table = await screen.findByRole('table', { name: /model başına betimsel değerler/ });
    const row = within(table).getByRole('row', { name: /claude-a/ });
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('-');
    expect(table).not.toHaveTextContent(/null|NaN/);
  });

  it('varsayılan olarak yalnızca Aşk, Doğa, Teknoloji temalarını ister; kutu işaretlenince hepsini', async () => {
    const fetchMock = mockApi({ stats: () => envelope(report) });
    renderPage();
    await screen.findByRole('table', { name: 'Model ve türe göre ortalama puan' });
    const first = new URL(statsUrls(fetchMock)[0]!, 'http://x');
    expect(first.searchParams.get('tema')).toBe('Aşk,Doğa,Teknoloji');

    await userEvent.click(screen.getByRole('checkbox', { name: /Deneme verisini de göster/ }));
    await vi.waitFor(() => expect(statsUrls(fetchMock)).toHaveLength(2));
    expect(new URL(statsUrls(fetchMock)[1]!, 'http://x').searchParams.has('tema')).toBe(false);
  });

  it('CSV indirme bağlantısı dışa aktarma ucunu gösterir', () => {
    mockApi({ stats: () => envelope(report) });
    renderPage();
    const link = screen.getByRole('link', { name: 'Puanları CSV indir' });
    expect(link).toHaveAttribute('href', '/api/v1/export?format=csv');
    expect(link).toHaveAttribute('download');
  });

  it('puanlama yoksa boş durum gösterir (hata değil)', async () => {
    mockApi({ stats: () => envelope({ olusturulma: report.olusturulma, kosullar: [] }) });
    renderPage();
    expect(await screen.findByText('Gösterilecek puanlama yok')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sunucuya ulaşılamazsa hata gösterir; "Tekrar dene" yeniden ister', async () => {
    const fetchMock = mockApi({ stats: () => envelope(report) });
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sonuçlar alınamadı');
    expect(alert).toHaveTextContent('Sunucuya ulaşılamıyor');

    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(
      await screen.findByRole('table', { name: 'Model ve türe göre ortalama puan' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('beklenen biçimde olmayan yanıtı çökmeden hata olarak gösterir', async () => {
    mockApi({ stats: () => envelope({ status: 'ok' }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('geçersiz yanıt');
  });

  it('birden çok koşul varsa en çok metni olan açılır; seçiciyle diğeri seçilir', async () => {
    // Alfabetik olarak önde gelen eski koşul az metinlidir: varsayılan o olmamalı.
    const old = { ...report.kosullar[0]!, hakem: 'a/eski-hakem', metin: 3 };
    mockApi({ stats: () => envelope({ ...report, kosullar: [old, report.kosullar[0]] }) });
    renderPage();
    const select = await screen.findByRole('combobox', { name: 'Koşul' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    expect(select).toHaveValue('1');
    expect(screen.getByText('deepseek-flash')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    await userEvent.selectOptions(select, '0');
    expect(screen.getByText('eski-hakem')).toBeInTheDocument();
    expect(screen.getByText('3', { selector: 'b' })).toBeInTheDocument();
  });
});
