import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  type Condition,
  type RubricLite,
  type StatsReport,
  authorsOf,
  heatTable,
  modelName,
} from '../features/analytics/data';
import {
  BarSection,
  HeatTableView,
  RadarSection,
  StatsSection,
} from '../features/analytics/sections';
import { ApiError, apiRequest, apiUrl } from '../lib/api';

/** Varsayılan görünüm: asıl veri setinin temaları. Deneme verisi (Sonbahar) kutu işaretlenince eklenir. */
const DEFAULT_THEMES = ['Aşk', 'Doğa', 'Teknoloji'];

async function fetchStats(showAll: boolean): Promise<StatsReport> {
  const query = showAll ? '' : `?tema=${encodeURIComponent(DEFAULT_THEMES.join(','))}`;
  const report = await apiRequest<StatsReport>(`/analytics/stats${query}`);
  if (!Array.isArray(report?.kosullar)) {
    throw new ApiError(200, 'INVALID_RESPONSE', 'Sunucudan geçersiz yanıt alındı.');
  }
  return report;
}

function Summary({ condition }: { condition: Condition }) {
  const items = [
    {
      // `metin` elle girilen (Karşılaştır sayfasından) ve ölçülemeyen metinleri de sayar; model analizine girenler ayrı.
      value: String(condition.metin - condition.elleGirilen - condition.olculemeyen),
      label: `Analize giren metin${condition.elleGirilen ? ` (${condition.elleGirilen} elle girilen hariç)` : ''}`,
    },
    { value: String(authorsOf(condition).length), label: 'Karşılaştırılan model' },
    { value: modelName(condition.hakem), label: `Hakem · rubrik ${condition.rubrikSurumu}` },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      {items.map((i) => (
        <li key={i.label} className="card-dark">
          <b className="block text-3xl leading-tight font-extrabold break-words">{i.value}</b>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function Analysis() {
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const stats = useQuery({
    queryKey: ['analytics-stats', showAll],
    queryFn: () => fetchStats(showAll),
  });
  // Kriter adları rubrikten gelir; alınamazsa sayfa çalışır, kriterler anahtarlarıyla görünür.
  const rubrics = useQuery({
    queryKey: ['rubrics'],
    queryFn: () => apiRequest<RubricLite[]>('/rubrics'),
  });

  const conditions = stats.data?.kosullar ?? [];
  // Seçilmediyse en çok metni olan koşul (asıl veri seti); eski denemelerin koşulları seçiciyle açılır.
  const mostTexts = conditions.reduce(
    (best, c, i) => (c.metin > conditions[best]!.metin ? i : best),
    0,
  );
  const index = picked !== null && picked < conditions.length ? picked : mostTexts;
  const condition = conditions[index];
  const heatGenre = useMemo(() => (condition ? heatTable(condition, 'tür ') : null), [condition]);
  const heatTheme = useMemo(() => (condition ? heatTable(condition, 'tema ') : null), [condition]);

  return (
    <div className="space-y-8">
      <section className="py-6 text-center" aria-labelledby="sayfa-baslik">
        <h1 id="sayfa-baslik" className="text-4xl sm:text-5xl">
          Sonuçlar ve Analiz
        </h1>
        <p className="text-muted mx-auto mt-3 max-w-2xl text-lg">
          Modellerin ürettiği metinlerin tek sabit yapay zekâ hakemin puanlarına göre
          karşılaştırması.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-accent h-5 w-5"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              setPicked(null);
            }}
          />
          Deneme verisini de göster (tüm temalar)
        </label>
        {conditions.length > 1 && (
          <label className="flex items-center gap-2">
            Koşul
            <select
              className="border-line bg-page rounded-xl border px-3 py-2"
              value={index}
              onChange={(e) => setPicked(Number(e.target.value))}
            >
              {conditions.map((c, i) => (
                <option key={`${c.hakem}|${c.rubrikSurumu}|${c.hakemKomutSurumu}`} value={i}>
                  {c.hakem} · rubrik {c.rubrikSurumu} · komut {c.hakemKomutSurumu ?? '?'}
                </option>
              ))}
            </select>
          </label>
        )}
        <a href={apiUrl('/export?format=csv')} download className="btn">
          Puanları CSV indir
        </a>
      </div>
      {!showAll && (
        <p className="text-muted -mt-4 text-sm">Gösterilen temalar: {DEFAULT_THEMES.join(', ')}.</p>
      )}

      {stats.isPending && <p role="status">Sonuçlar yükleniyor…</p>}

      {stats.isError && (
        <div role="alert" className="card">
          <p className="text-bad font-bold">✖ Sonuçlar alınamadı</p>
          <p>
            {stats.error instanceof ApiError ? stats.error.message : 'Beklenmeyen bir hata oluştu.'}
          </p>
          <button type="button" className="btn mt-3" onClick={() => void stats.refetch()}>
            Tekrar dene
          </button>
        </div>
      )}

      {stats.isSuccess && !condition && (
        <div className="card text-center">
          <p className="text-lg font-bold">Gösterilecek puanlama yok</p>
          <p className="text-muted">
            Seçili temalarda puanlanmış metin bulunamadı. Üretim ve puanlama yapıldıktan sonra
            sonuçlar burada görünür.
          </p>
        </div>
      )}

      {condition && heatGenre && heatTheme && (
        <>
          {condition.rubrikSurumu.includes('taslak') && (
            <p className="badge text-warn">
              ▲ Taslak rubrik ({condition.rubrikSurumu}): uzman doğrulaması yok, sonuçlar geçicidir.
            </p>
          )}
          <Summary condition={condition} />

          <section className="card" aria-labelledby="tablo-baslik">
            <h2 id="tablo-baslik" className="text-2xl">
              Ortalama puanlar (0-100)
            </h2>
            <p className="text-muted mb-3">
              Hücre: modelin o türdeki metinlerinin ortalaması. Koyu hücre, tablodaki göreli olarak
              yüksek değerdir.
            </p>
            <HeatTableView heat={heatGenre} caption="Model ve türe göre ortalama puan" />
            {heatTheme.columns.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg">Temaya göre (yalnızca betimsel)</h3>
                <HeatTableView heat={heatTheme} caption="Model ve temaya göre ortalama puan" />
              </div>
            )}
          </section>

          <BarSection condition={condition} />
          <RadarSection condition={condition} rubrics={rubrics.data} />
          <StatsSection condition={condition} />
        </>
      )}
    </div>
  );
}
