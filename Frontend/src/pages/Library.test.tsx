import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { envelope } from '../test/analytics-fixture';
import { texts } from '../test/library-fixture';
import { Library } from './Library';

function renderPage() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stub = (data: unknown = texts) => {
  const fetchMock = vi.fn((_url: string) => Promise.resolve(envelope(data)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const queryOf = (fetchMock: ReturnType<typeof stub>, call: number) =>
  new URL(fetchMock.mock.calls[call]![0], 'http://x').searchParams;

describe('Üretim ve Kütüphane sayfası', () => {
  it('başlık ve üretim bilgisi hemen görünür; yüklenirken durum bildirilir', () => {
    stub();
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Üretim ve Kütüphane' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Metinler yükleniyor');
    expect(screen.getByText(/npm run batch -- uret/)).toBeInTheDocument();
    expect(screen.getByText(/gerçek \(ücretli\) üretimi başlatır/)).toBeInTheDocument();
  });

  it('metinleri tablo olarak gösterir: kimlik bağlantısı, tür, tema, yazar, kaynak, sözcük, puanlama, özet', async () => {
    const fetchMock = stub();
    renderPage();
    const table = await screen.findByRole('table', { name: 'Metin kütüphanesi' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/texts');

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(cells(rows[0]!)).toEqual([
      'Şiir',
      'Doğa',
      'Claude Sonnet 5.5',
      'Üretilen',
      '4',
      '3',
      'Yaprak düşer, rüzgâr eser.',
    ]);
    expect(cells(rows[1]!).slice(0, 2)).toEqual(['Hikâye', 'Aşk']);
    // Elle girilen metin: yazar yerine etiket, kaynak "Elle girilen", puanlama 0.
    expect(cells(rows[2]!)).toEqual([
      'Şiir',
      'Sonbahar',
      'ChatGPT',
      'Elle girilen',
      '4',
      '0',
      'Elle yazılmış.',
    ]);
  });

  it('her satırdaki bağlantı metnin ayrıntı sayfasına gider', async () => {
    stub();
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: 'Metin 4' })).toHaveAttribute('href', '/uretim/4');
    expect(screen.getByRole('link', { name: 'Metin 31' })).toHaveAttribute('href', '/uretim/31');
  });

  it('metin sayısını bildirir', async () => {
    stub();
    renderPage();
    expect(await screen.findByText('3 metin')).toBeInTheDocument();
  });

  it('süzgeç seçilince sunucudan süzgeçli liste ister; sayı "(süzgece uyan)" der', async () => {
    const fetchMock = stub();
    renderPage();
    await screen.findByRole('table');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), 'hikaye');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(queryOf(fetchMock, 1).get('genre')).toBe('hikaye');
    expect(queryOf(fetchMock, 1).has('theme')).toBe(false);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tema' }), 'Doğa');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kaynak' }), 'manual');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const last = queryOf(fetchMock, 3);
    expect([last.get('genre'), last.get('theme'), last.get('source')]).toEqual([
      'hikaye',
      'Doğa',
      'manual',
    ]);
    expect(await screen.findByText(/metin \(süzgece uyan\)/)).toBeInTheDocument();
  });

  it('"Süzgeçleri temizle" yalnızca süzgeç varken görünür ve hepsini sıfırlar', async () => {
    const fetchMock = stub();
    renderPage();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Süzgeçleri temizle' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), 'siir');
    await userEvent.click(await screen.findByRole('button', { name: 'Süzgeçleri temizle' }));

    expect(screen.getByRole('combobox', { name: 'Tür' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Süzgeçleri temizle' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('3 metin')).toBeInTheDocument());
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/v1/texts');
  });

  it('süzgeçle eşleşme yoksa süzgeci gevşetmeyi önerir; süzgeçsiz boş kütüphanede üretimi anlatır', async () => {
    const fetchMock = stub([]);
    renderPage();
    expect(await screen.findByText(/Henüz metin yok/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), 'deneme');
    expect(await screen.findByText(/süzgece uyan metin bulunamadı/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sunucuya ulaşılamazsa hata gösterir; "Tekrar dene" yeniden ister', async () => {
    const fetchMock = stub();
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Metinler alınamadı');
    expect(alert).toHaveTextContent('Sunucuya ulaşılamıyor');
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
