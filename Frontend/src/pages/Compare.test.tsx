import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { envelope } from '../test/analytics-fixture';
import { failedItem, result, succeededItem, threeItems } from '../test/compare-fixture';
import { Compare } from './Compare';

function renderPage() {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Compare />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const post = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

const errorEnvelope = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function fill(letter: string, body: string, label = '') {
  if (label)
    await userEvent.type(
      screen.getByLabelText(`Model etiketi (isteğe bağlı)`, { selector: `#etiket-${letter}` }),
      label,
    );
  await userEvent.type(screen.getByLabelText(`Metin ${letter} içeriği`), body);
}

describe('Karşılaştır sayfası', () => {
  it('başlık, tür ve tema seçicileri ve üç metin alanı vardır; sayfa açılınca istek atılmaz', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Karşılaştır' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Tür' })).toHaveValue('siir');
    expect(screen.getByRole('combobox', { name: 'Tema' })).toHaveValue('Aşk');
    for (const l of ['A', 'B', 'C']) {
      expect(screen.getByLabelText(`Metin ${l} içeriği`)).toBeInTheDocument();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('karakter sayacı yazdıkça güncellenir ve alan 20000 karakterle sınırlıdır', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderPage();
    const box = screen.getByLabelText('Metin A içeriği');
    expect(box).toHaveAttribute('maxlength', '20000');
    expect(screen.getAllByText('0 / 20.000 karakter')).toHaveLength(3);
    await userEvent.type(box, 'Yaprak');
    expect(screen.getByText('6 / 20.000 karakter')).toBeInTheDocument();
  });

  it('iki metinden azıyla gönderilmez: uyarı çıkar, istek atılmaz', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await fill('A', 'Tek metin');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('En az iki metin girin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('boşluktan ibaret metin sayılmaz', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await fill('A', 'Gerçek metin');
    await userEvent.type(screen.getByLabelText('Metin B içeriği'), '    ');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('seçimleri ve dolu metinleri doğru gövdeyle POST eder (boş yuva atlanır, harf korunur)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(envelope(threeItems)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), 'deneme');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tema' }), 'Doğa');
    await fill('A', 'Birinci', 'ChatGPT');
    await fill('C', 'Üçüncü');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));

    await screen.findByRole('heading', { name: 'Sonuç' });
    expect(post(fetchMock)).toHaveLength(1);
    const [url] = post(fetchMock)[0]!;
    expect(url).toBe('/api/v1/comparisons');
    expect(bodyOf(post(fetchMock)[0]!)).toEqual({
      genre: 'deneme',
      theme: 'Doğa',
      items: [
        { label: 'ChatGPT', body: 'Birinci' },
        { label: 'Metin C', body: 'Üçüncü' },
      ],
    });
  });

  it('puanlanırken düğme kapanır, durum bildirilir; çift tıklama ikinci istek atmaz', async () => {
    let finish: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (finish = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await fill('A', 'bir');
    await fill('B', 'iki');
    const button = screen.getByRole('button', { name: 'Karşılaştır' });
    await userEvent.dblClick(button);

    expect(await screen.findByRole('status')).toHaveTextContent('Hakem metinleri puanlıyor');
    expect(screen.getByRole('button', { name: 'Puanlanıyor…' })).toBeDisabled();
    expect(post(fetchMock)).toHaveLength(1);

    finish(envelope(threeItems));
    await screen.findByRole('heading', { name: 'Sonuç' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Karşılaştır' })).toBeEnabled();
  });

  it('sonuç: toplam puanlar, en yüksek toplam, kriter tablosu, ağırlıklar ve maliyet görünür', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelope(threeItems))),
    );
    renderPage();
    await fill('A', 'bir');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));

    const section = await screen.findByRole('region', { name: 'Sonuç' });
    expect(section).toHaveTextContent('hakem deepseek/deepseek-flash');
    expect(section).toHaveTextContent('maliyet ≈ $0,0036');
    expect(section).toHaveTextContent('Taslak rubrik (0.1-taslak)');

    // Toplam kartları: yalnızca Claude (85,5) "En yüksek".
    const cards = within(section).getAllByRole('listitem');
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('70,0'),
      expect.stringContaining('85,5'),
      expect.stringContaining('60,0'),
    ]);
    expect(within(section).getAllByText('★ En yüksek toplam puan')).toHaveLength(1);
    expect(cards[1]).toHaveTextContent('★ En yüksek toplam puan');

    const table = within(section).getByRole('table', { name: /kriter bazında ham puanları/ });
    expect(within(table).getByRole('rowheader', { name: /İmge gücü.*%60/ })).toBeInTheDocument();
    expect(
      within(table).getByRole('rowheader', { name: /Ritim ve ahenk.*%40/ }),
    ).toBeInTheDocument();
    const imge = within(table).getByRole('row', { name: /İmge gücü/ });
    // İmge: ChatGPT 3, Claude 5 (en yüksek), Gemini 3
    expect(
      within(imge)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['3 / 5', '5 / 5 (en yüksek)', '3 / 5']);
    const ritim = within(table).getByRole('row', { name: /Ritim ve ahenk/ });
    expect(within(ritim).getAllByRole('cell')[0]).toHaveTextContent('5 / 5 (en yüksek)');
  });

  it('maliyet bilinmiyorsa (fiyatsız model) maliyet satırı hiç görünmez, 0 yazılmaz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelope({ ...threeItems, totalCostUsd: null }))),
    );
    renderPage();
    await fill('A', 'bir');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    const section = await screen.findByRole('region', { name: 'Sonuç' });
    expect(section).not.toHaveTextContent('maliyet');
    expect(section).not.toHaveTextContent('$');
  });

  it('hakemin gerekçeleri her metin için açılır bölümde yazılıdır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelope(threeItems))),
    );
    renderPage();
    await fill('A', 'bir');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    await screen.findByRole('heading', { name: 'Sonuç' });
    expect(screen.getByText('Claude imge gerekçesi')).toBeInTheDocument();
    expect(screen.getByText('Claude ritim gerekçesi')).toBeInTheDocument();
  });

  it('biri puanlanamazsa o metin işaretlenir, diğerlerinin sonucu görünür', async () => {
    const mixed = result([
      succeededItem(1, 'ChatGPT', 70, { imge: 3, ritim: 5 }),
      failedItem(2, 'Claude'),
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelope(mixed))),
    );
    renderPage();
    await fill('A', 'bir');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));

    const section = await screen.findByRole('region', { name: 'Sonuç' });
    expect(within(section).getByText('✖ Puanlanamadı', { exact: false })).toBeInTheDocument();
    expect(section).toHaveTextContent('hakem geçersiz cevap verdi');
    expect(section).toHaveTextContent('70,0');
    const table = within(section).getByRole('table', { name: /kriter bazında/ });
    const imge = within(table).getByRole('row', { name: /İmge gücü/ });
    // Başarısız metin 0 sayılmaz, "puan yok" görünür; tek puan olan metin "en yüksek" sayılmaz çünkü karşılaştırılacak biri yok.
    expect(within(imge).getByLabelText('puan yok')).toBeInTheDocument();
  });

  it('sunucu hatasında mesajı gösterir ve yazılan metinleri korur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(errorEnvelope(503, 'SERVICE_UNAVAILABLE', 'Hakem model kullanılamıyor')),
      ),
    );
    renderPage();
    await fill('A', 'Korunacak metin');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Karşılaştırma yapılamadı');
    expect(alert).toHaveTextContent('Hakem model kullanılamıyor');
    expect(screen.getByLabelText('Metin A içeriği')).toHaveValue('Korunacak metin');
    expect(screen.queryByRole('heading', { name: 'Sonuç' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Karşılaştır' })).toBeEnabled();
  });

  it('ağ hatasında yeniden denemez (ücretli çağrı): tek istek atılır', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await fill('A', 'bir');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamıyor');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('hata sonrası düzeltilen uyarı yeni gönderimde kalkar', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(envelope(threeItems)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await fill('A', 'bir');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('En az iki metin');
    await fill('B', 'iki');
    await userEvent.click(screen.getByRole('button', { name: 'Karşılaştır' }));
    await screen.findByRole('heading', { name: 'Sonuç' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
