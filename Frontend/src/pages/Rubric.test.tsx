import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { envelope } from '../test/analytics-fixture';
import { rubrics } from '../test/rubric-fixture';
import { RubricPage } from './Rubric';

function renderPage() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RubricPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stubRubrics = (data: unknown = rubrics) => {
  const fetchMock = vi.fn((_url: string) => Promise.resolve(envelope(data)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('Rubrik ve Hakkında sayfası: rubrik', () => {
  it('başlık hemen görünür; yüklenirken durum bildirilir', () => {
    stubRubrics();
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Rubrik ve Hakkında' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Rubrikler yükleniyor');
  });

  it('varsayılan olarak şiirin etkin rubriğini, durumuyla ve rubrik listesini isteyerek gösterir', async () => {
    const fetchMock = stubRubrics();
    renderPage();
    const heading = await screen.findByRole('heading', {
      name: /Şiir rubriği · sürüm 0\.1-taslak/,
    });
    expect(heading).toHaveTextContent('Etkin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/rubrics');
    expect(screen.getByRole('button', { name: 'Şiir' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('taslak rubriğin kaynak notunu uyarı olarak gösterir', async () => {
    stubRubrics();
    renderPage();
    expect(await screen.findByText(/▲ GEÇİCİ TASLAK: uzman doğrulaması yok\./)).toBeInTheDocument();
  });

  it('kriterleri ağırlık yüzdesiyle, açıklamasıyla ve düzeyleriyle gösterir', async () => {
    stubRubrics();
    renderPage();
    await screen.findByRole('heading', { name: /Şiir rubriği/ });
    expect(screen.getByRole('heading', { name: /İmge Gücü.*ağırlık %50/ })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Ritim ve Ahenk.*ağırlık %30/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Özgünlük.*ağırlık %20/ })).toBeInTheDocument();
    expect(screen.getByText('İmge Gücü açıklaması')).toBeInTheDocument();

    // Düzey tablosu: ham puan, 0-100 karşılığı, açıklama (1→0, 3→50, 5→100).
    const table = screen.getByRole('table', { name: 'İmge Gücü: puan düzeyleri' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['1', '0', 'İmge Gücü 1 puan düzeyi'],
      ['3', '50', 'İmge Gücü 3 puan düzeyi'],
      ['5', '100', 'İmge Gücü 5 puan düzeyi'],
    ]);
  });

  it('birden çok sürüm varsa seçici çıkar; arşiv sürümü seçilince o rubrik gösterilir', async () => {
    stubRubrics();
    renderPage();
    const select = await screen.findByRole('combobox', { name: 'Sürüm' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['0.1-taslak (Etkin)', '0.2 (Taslak)', '0.0 (Arşiv)']);
    await userEvent.selectOptions(select, '0.0');
    const heading = screen.getByRole('heading', { name: /Şiir rubriği · sürüm 0\.0/ });
    expect(heading).toHaveTextContent('Arşiv');
    expect(screen.getByRole('heading', { name: /Eski Kriter/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /İmge Gücü/ })).not.toBeInTheDocument();
  });

  it('tür değişince o türün rubriği gelir; tek sürüm varsa seçici yoktur; 0-100 karşılığı ölçeğe göre', async () => {
    stubRubrics();
    renderPage();
    await screen.findByRole('heading', { name: /Şiir rubriği/ });
    await userEvent.click(screen.getByRole('button', { name: 'Hikâye' }));

    expect(
      screen.getByRole('heading', { name: /Hikâye rubriği · sürüm 1\.0/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Sürüm' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hikâye' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Şiir' })).toHaveAttribute('aria-pressed', 'false');
    // 1-4 ölçeğinde 3 puan: (3-1)/(4-1)*100 = 66,7 → "67"
    const table = screen.getByRole('table', { name: 'Olay Örgüsü: puan düzeyleri' });
    expect(within(table).getByText('67')).toBeInTheDocument();
    expect(screen.getByText(/1 ile 4 arasında ham puanlanır/)).toBeInTheDocument();
  });

  it('türe dönünce önceden seçilmiş eski sürüm kalmaz: yine etkin rubrik açılır', async () => {
    stubRubrics();
    renderPage();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Sürüm' }), '0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Hikâye' }));
    await userEvent.click(screen.getByRole('button', { name: 'Şiir' }));
    expect(
      screen.getByRole('heading', { name: /Şiir rubriği · sürüm 0\.1-taslak/ }),
    ).toBeInTheDocument();
  });

  it('kaydı olmayan türde boş durum gösterir (hata değil)', async () => {
    stubRubrics();
    renderPage();
    await screen.findByRole('heading', { name: /Şiir rubriği/ });
    await userEvent.click(screen.getByRole('button', { name: 'Deneme' }));
    expect(screen.getByText('Bu tür için kayıtlı rubrik yok')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /rubriği · sürüm/ })).not.toBeInTheDocument();
  });

  it('sunucuya ulaşılamazsa hata gösterir; "Tekrar dene" yeniden ister', async () => {
    const fetchMock = stubRubrics();
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Rubrikler alınamadı');
    expect(alert).toHaveTextContent('Sunucuya ulaşılamıyor');
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('heading', { name: /Şiir rubriği/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Rubrik ve Hakkında sayfası: hakkında', () => {
  it('amaç, yöntem, sınırlılıklar ve veri/gizlilik bölümleri rubrik yüklenmeden de görünür', () => {
    stubRubrics();
    renderPage();
    for (const name of ['Hakkında', 'Yöntem', 'Sınırlılıklar', 'Veri ve gizlilik']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('hakemi ve kör puanlamayı anlatır; "anlamlı" eşiği olmadığını söyler', () => {
    stubRubrics();
    renderPage();
    expect(
      screen.getByText(/tek ve sabit bir yapay zekâ hakem \(DeepSeek Flash\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/metnin hangi modelden geldiğini görmez/)).toBeInTheDocument();
    expect(screen.getByText(/Eşik ya da "anlamlı" yargısı verilmez/)).toBeInTheDocument();
  });

  it('taslak rubrik ve hakem sınırlılıklarını açıkça yazar', () => {
    stubRubrics();
    renderPage();
    expect(screen.getByText(/uzman doğrulaması yoktur/)).toBeInTheDocument();
    expect(screen.getByText(/insan değerlendirmesiyle ne kadar uyumlu/)).toBeInTheDocument();
  });

  it("Karşılaştır'a girilen metinlerin hakem hizmetine gittiğini söyler ve CSV için Analiz sayfasına bağlanır", () => {
    stubRubrics();
    renderPage();
    expect(screen.getByText(/hakem hizmetine gönderilir/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sonuçlar ve Analiz sayfası' })).toHaveAttribute(
      'href',
      '/analiz',
    );
  });
});
