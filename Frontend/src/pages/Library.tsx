import { ScrollRegion } from '../components/ScrollRegion';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { genreLabel } from '../features/analytics/data';
import { GENRES, THEMES } from '../features/compare/data';
import {
  NO_FILTERS,
  SOURCE_LABEL,
  buildQuery,
  hasFilters,
  writerName,
  type Filters,
  type Source,
  type TextSummary,
} from '../features/library/data';
import { ApiError, apiRequest } from '../lib/api';

export function Library() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const texts = useQuery({
    queryKey: ['texts', filters],
    queryFn: () => apiRequest<TextSummary[]>(`/texts${buildQuery(filters)}`),
  });
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  // Seçili tema sabit listede yoksa (örn. veritabanında başka temalı metin) seçenek olarak kalır.
  const themes: string[] = [...THEMES];
  if (filters.theme && !themes.includes(filters.theme)) themes.push(filters.theme);

  return (
    <div className="space-y-8">
      <section className="py-6 text-center" aria-labelledby="sayfa-baslik">
        <h1 id="sayfa-baslik" className="text-4xl sm:text-5xl">
          Üretim ve Kütüphane
        </h1>
        <p className="text-muted mx-auto mt-3 max-w-2xl text-lg">
          Modellerin ürettiği ve elle girilen tüm metinler: süzün, okuyun, hakemin puanlarını ve
          gerekçelerini görün.
        </p>
      </section>

      <section aria-labelledby="uretim-baslik" className="card">
        <h2 id="uretim-baslik" className="text-2xl">
          Üretim
        </h2>
        <p className="mt-2 max-w-3xl">
          Metin üretimi şu an komut satırından yapılır:{' '}
          <code className="bg-soft rounded px-1.5 py-0.5">npm run batch -- uret …</code> önce
          yalnızca planı ve tahmini maliyeti gösterir,{' '}
          <code className="bg-soft rounded px-1.5 py-0.5">--calistir</code> ile gerçek (ücretli)
          üretimi başlatır. Üretilen her metin aşağıdaki kütüphaneye düşer.
        </p>
      </section>

      <section aria-labelledby="kutuphane-baslik" className="space-y-4">
        <h2 id="kutuphane-baslik" className="text-3xl">
          Kütüphane
        </h2>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            Tür
            <select
              className="field"
              value={filters.genre}
              onChange={(e) => set({ genre: e.target.value })}
            >
              <option value="">Tümü</option>
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {genreLabel(g)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Tema
            <select
              className="field"
              value={filters.theme}
              onChange={(e) => set({ theme: e.target.value })}
            >
              <option value="">Tümü</option>
              {themes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Kaynak
            <select
              className="field"
              value={filters.source}
              onChange={(e) => set({ source: e.target.value })}
            >
              <option value="">Tümü</option>
              {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {hasFilters(filters) && (
            <button type="button" className="btn" onClick={() => setFilters(NO_FILTERS)}>
              Süzgeçleri temizle
            </button>
          )}
        </div>

        {texts.isPending && <p role="status">Metinler yükleniyor…</p>}

        {texts.isError && (
          <div role="alert" className="card">
            <p className="text-bad font-bold">✖ Metinler alınamadı</p>
            <p>
              {texts.error instanceof ApiError
                ? texts.error.message
                : 'Beklenmeyen bir hata oluştu.'}
            </p>
            <button type="button" className="btn mt-3" onClick={() => void texts.refetch()}>
              Tekrar dene
            </button>
          </div>
        )}

        {texts.isSuccess && (
          <p role="status" className="text-muted">
            {texts.data.length} metin
            {hasFilters(filters) ? ' (süzgece uyan)' : ''}
          </p>
        )}

        {texts.isSuccess && texts.data.length === 0 && (
          <div className="card text-center">
            <p className="text-lg font-bold">Gösterilecek metin yok</p>
            <p className="text-muted">
              {hasFilters(filters)
                ? 'Bu süzgece uyan metin bulunamadı; süzgeçleri gevşetmeyi deneyin.'
                : 'Henüz metin yok. Üretim yapıldığında ya da Karşılaştır sayfasından metin girildiğinde burada görünür.'}
            </p>
          </div>
        )}

        {texts.isSuccess && texts.data.length > 0 && (
          <ScrollRegion label="Metin kütüphanesi">
            <table className="table-plain">
              <caption className="sr-only">Metin kütüphanesi</caption>
              <thead>
                <tr>
                  <th scope="col">Metin</th>
                  <th scope="col">Tür</th>
                  <th scope="col">Tema</th>
                  <th scope="col">Yazar</th>
                  <th scope="col">Kaynak</th>
                  <th scope="col" className="num">
                    Sözcük
                  </th>
                  <th scope="col" className="num">
                    Puanlama
                  </th>
                  <th scope="col">Özet</th>
                </tr>
              </thead>
              <tbody>
                {texts.data.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">
                      {/* Erişilebilir ad görünen "#4" metnini içerir (WCAG 2.5.3, ses komutuyla seçilebilsin). */}
                      <Link to={`/uretim/${t.id}`} aria-label={`Metin #${t.id}`}>
                        #{t.id}
                      </Link>
                    </th>
                    <td>{genreLabel(t.genre)}</td>
                    <td>{t.theme}</td>
                    <td>{writerName(t)}</td>
                    <td>{SOURCE_LABEL[t.source]}</td>
                    <td className="num">{t.wordCount}</td>
                    <td className="num">{t.succeededEvaluations}</td>
                    <td className="min-w-64 font-serif text-base">{t.excerpt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
    </div>
  );
}
