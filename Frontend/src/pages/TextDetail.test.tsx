import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { envelope } from '../test/analytics-fixture';
import { detail, evaluation } from '../test/library-fixture';
import { TextDetail } from './TextDetail';

function renderPage(path = '/uretim/5') {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/uretim" element={<p>Kütüphane sayfası</p>} />
          <Route path="/uretim/:id" element={<TextDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stub = (response: () => Response | Promise<Response> = () => envelope(detail())) => {
  const fetchMock = vi.fn((_url: string) => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const errorEnvelope = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Metin ayrıntısı', () => {
  it('kimliği adrese koyarak metni ister; yüklenirken durum bildirilir', async () => {
    const fetchMock = stub();
    renderPage('/uretim/5');
    expect(screen.getByRole('status')).toHaveTextContent('Metin yükleniyor');
    await screen.findByRole('heading', { level: 1, name: 'Metin #5' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/texts/5');
  });

  it('künyeyi gösterir: tür, tema, yazar, kaynak, sözcük sayısı, tarih', async () => {
    stub();
    renderPage();
    const meta = await screen.findByText(/Şiir · Doğa · Claude Sonnet 5\.5 · Üretilen/);
    expect(meta).toHaveTextContent('4 sözcük');
    expect(meta).toHaveTextContent('24 Kasım 2026');
  });

  it('metnin satır sonlarını korur; şiir italik, düzyazı italik değildir', async () => {
    stub();
    renderPage();
    const poem = within(await screen.findByRole('article', { name: 'Metin' })).getByText(
      /Yaprak düşer/,
    );
    expect(poem.textContent).toBe('Yaprak düşer,\nrüzgâr eser.');
    expect(poem).toHaveClass('whitespace-pre-wrap', 'italic');
  });

  it('hikâye ve denemede metin italik değildir', async () => {
    stub(() => envelope(detail({ genre: 'hikaye' })));
    renderPage();
    const text = within(await screen.findByRole('article', { name: 'Metin' })).getByText(
      /Yaprak düşer/,
    );
    expect(text).not.toHaveClass('italic');
  });

  it('üretim bilgisini yazar: komut, tekrar, token ve süre', async () => {
    stub();
    renderPage();
    expect(
      await screen.findByText(
        'Üretim: komut v1 · tekrar 2 · 1.234 giriş + 200 çıkış token · 6,1 sn',
      ),
    ).toBeInTheDocument();
  });

  it('puanlamaları koşul başlığı, ortalama (yalnızca başarılı tekrarlar) ve tekrar sayısıyla gösterir', async () => {
    stub();
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: 'Hakem deepseek-flash · rubrik 0.1-taslak · komut v1',
      }),
    ).toBeInTheDocument();
    // (65 + 80) / 2 = 72,5; başarısız üçüncü tekrar ortalamaya girmez.
    expect(screen.getByText('72,5', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/\(2 başarılı tekrar\)/)).toBeInTheDocument();
  });

  it('kriter × tekrar tablosunu ve ortalamaları verir', async () => {
    stub();
    renderPage();
    const table = await screen.findByRole('table', { name: /kriter puanları/ });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Kriter', 'Tekrar 1', 'Tekrar 2', 'Ortalama']);
    const row = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(row(/İmge Gücü/)).toEqual(['5', '4', '4,5']);
    expect(row(/Ritim ve Ahenk/)).toEqual(['3', '4', '3,5']);
    expect(row(/Toplam/)).toEqual(['65,0', '80,0', '72,5']);
  });

  it('başarısız tekrarı nedeniyle listeler; puan uydurmaz', async () => {
    stub();
    renderPage();
    expect(await screen.findByText('✖ Tekrar 3 puanlanamadı', { exact: false })).toHaveTextContent(
      'hakem geçersiz cevap verdi',
    );
    expect(screen.queryByRole('columnheader', { name: 'Tekrar 3' })).not.toBeInTheDocument();
  });

  it('hakemin gerekçelerini her başarılı tekrar için açılır bölümde yazar; gerekçesiz kriteri belirtir', async () => {
    stub();
    renderPage();
    expect(await screen.findByText('Hakemin gerekçeleri: tekrar 1')).toBeInTheDocument();
    expect(screen.getByText('Hakemin gerekçeleri: tekrar 2')).toBeInTheDocument();
    expect(screen.queryByText('Hakemin gerekçeleri: tekrar 3')).not.toBeInTheDocument();
    expect(screen.getByText('imge gerekçesi 1')).toBeInTheDocument();
    expect(screen.getByText('ikinci imge')).toBeInTheDocument();
    expect(screen.getByText('(gerekçe yok)')).toBeInTheDocument();
  });

  it('farklı koşullar (hakem, rubrik sürümü) ayrı bloklar olarak gelir, puanları karışmaz', async () => {
    stub(() =>
      envelope(
        detail({
          evaluations: [
            evaluation(1, 1, { totalScore: 80 }),
            evaluation(2, 1, {
              judge: 'anthropic/claude-sonnet-5-5',
              templateVersion: null,
              totalScore: 40,
            }),
            evaluation(3, 1, { rubricVersion: '0.2', totalScore: 60 }),
          ],
        }),
      ),
    );
    renderPage();
    await screen.findByRole('heading', { name: /Hakem deepseek-flash · rubrik 0\.1-taslak/ });
    expect(
      screen
        .getAllByRole('article')
        .filter((a) => a.tagName === 'ARTICLE' && a.getAttribute('aria-label') !== 'Metin'),
    ).toHaveLength(3);
    expect(
      screen.getByRole('heading', { name: 'Hakem claude-sonnet-5-5 · rubrik 0.1-taslak' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Hakem deepseek-flash · rubrik 0.2 · komut v1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('40,0', { selector: 'b' })).toBeInTheDocument();
  });

  it('hiç başarılı tekrarı olmayan koşulda tablo ve ortalama gösterilmez, nedenler listelenir', async () => {
    stub(() =>
      envelope(
        detail({
          evaluations: [
            evaluation(1, 1, {
              status: 'failed',
              totalScore: null,
              scores: [],
              error: 'kota aşıldı',
            }),
            evaluation(2, 2, {
              status: 'failed',
              totalScore: null,
              scores: [],
              error: 'zaman aşımı',
            }),
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('Başarılı puanlama yok.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ortalama toplam puan/)).not.toBeInTheDocument();
    expect(screen.getByText(/kota aşıldı/)).toBeInTheDocument();
    expect(screen.getByText(/zaman aşımı/)).toBeInTheDocument();
  });

  it('bir tekrarda olmayan kriter "-" görünür (0 sanılmaz)', async () => {
    stub(() =>
      envelope(
        detail({
          evaluations: [
            evaluation(1, 1),
            evaluation(2, 2, {
              scores: [{ key: 'imge', label: 'İmge Gücü', score: 4, comment: 'yalnızca imge' }],
            }),
          ],
        }),
      ),
    );
    renderPage();
    const table = await screen.findByRole('table', { name: /kriter puanları/ });
    const ritim = within(within(table).getByRole('row', { name: /Ritim ve Ahenk/ })).getAllByRole(
      'cell',
    );
    expect(ritim.map((c) => c.textContent)).toEqual(['3', '-', '3,0']);
  });

  it('puanlaması olmayan metinde boş durum gösterir', async () => {
    stub(() => envelope(detail({ evaluations: [] })));
    renderPage();
    expect(await screen.findByText('Bu metin henüz puanlanmadı')).toBeInTheDocument();
  });

  it('elle girilen metinde yazar yerine etiket görünür, üretim satırı yoktur', async () => {
    stub(() =>
      envelope(detail({ source: 'manual', author: null, label: 'ChatGPT', generation: null })),
    );
    renderPage();
    expect(await screen.findByText(/Şiir · Doğa · ChatGPT · Elle girilen/)).toBeInTheDocument();
    expect(screen.queryByText(/Üretim: komut/)).not.toBeInTheDocument();
  });

  it('üretim satırı, token ve süre bilinmiyorsa onları yazmaz', async () => {
    stub(() =>
      envelope(
        detail({
          generation: {
            templateVersion: 'v1',
            replicateNo: 1,
            inputTokens: null,
            outputTokens: null,
            latencyMs: null,
          },
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('Üretim: komut v1 · tekrar 1')).toBeInTheDocument();
  });

  it('metin yoksa (404) "Metin bulunamadı" der, yeniden deneme önermez, kütüphaneye döndürür', async () => {
    stub(() => errorEnvelope(404, 'NOT_FOUND', 'Metin bulunamadı: 5'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Metin bulunamadı' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Metin bulunamadı: 5');
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: '← Kütüphaneye dön' }));
    expect(screen.getByText('Kütüphane sayfası')).toBeInTheDocument();
  });

  it('sunucu hatasında "Metin alınamadı" der; "Tekrar dene" yeniden ister', async () => {
    const fetchMock = stub(() => envelope(detail()));
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Metin alınamadı' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sunucuya ulaşılamıyor');
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('heading', { name: 'Metin #5' })).toBeInTheDocument();
  });

  it.each(['abc', '0', '-3', '1.5', '007'])('geçersiz kimlik %s: sunucuya gidilmez', (id) => {
    const fetchMock = stub();
    renderPage(`/uretim/${id}`);
    expect(screen.getByRole('heading', { name: 'Geçersiz metin kimliği' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('her durumda kütüphaneye dönüş bağlantısı vardır', async () => {
    stub();
    renderPage();
    await screen.findByRole('heading', { name: 'Metin #5' });
    expect(screen.getByRole('link', { name: '← Kütüphaneye dön' })).toHaveAttribute(
      'href',
      '/uretim',
    );
  });
});
