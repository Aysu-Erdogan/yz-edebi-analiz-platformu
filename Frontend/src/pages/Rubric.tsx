import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { genreLabel } from '../features/analytics/data';
import { GENRES } from '../features/compare/data';
import { About } from '../features/rubric/About';
import { STATUS_LABEL, rubricsOfGenre, type Rubric } from '../features/rubric/data';
import { RubricView } from '../features/rubric/RubricView';
import { ApiError, apiRequest } from '../lib/api';

export function RubricPage() {
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [version, setVersion] = useState<string | null>(null);
  const rubrics = useQuery({
    queryKey: ['rubrics', 'all'],
    queryFn: () => apiRequest<Rubric[]>('/rubrics'),
  });

  const ofGenre = rubricsOfGenre(rubrics.data ?? [], genre);
  // Seçilmediyse (ya da başka türden kalan bir sürüm seçiliyse) listenin ilki: etkin rubrik.
  const rubric = ofGenre.find((r) => r.version === version) ?? ofGenre[0];

  return (
    <div className="space-y-10">
      <section className="py-6 text-center" aria-labelledby="sayfa-baslik">
        <h1 id="sayfa-baslik" className="text-4xl sm:text-5xl">
          Rubrik ve Hakkında
        </h1>
        <p className="text-muted mx-auto mt-3 max-w-2xl text-lg">
          Metinlerin hangi ölçütlerle puanlandığını ve projenin yöntemini inceleyin.
        </p>
      </section>

      <section aria-labelledby="rubrik-baslik" className="space-y-6">
        <h2 id="rubrik-baslik" className="text-3xl">
          Rubrik
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="group" aria-label="Tür" className="flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={g === genre}
                className={`btn ${g === genre ? 'btn-primary' : ''}`}
                onClick={() => {
                  setGenre(g);
                  setVersion(null);
                }}
              >
                {genreLabel(g)}
              </button>
            ))}
          </div>
          {ofGenre.length > 1 && (
            <label className="flex items-center gap-2">
              Sürüm
              <select
                className="border-line bg-page rounded-xl border px-3 py-2"
                value={rubric?.version}
                onChange={(e) => setVersion(e.target.value)}
              >
                {ofGenre.map((r) => (
                  <option key={r.id} value={r.version}>
                    {r.version} ({STATUS_LABEL[r.status]})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {rubrics.isPending && <p role="status">Rubrikler yükleniyor…</p>}

        {rubrics.isError && (
          <div role="alert" className="card">
            <p className="text-bad font-bold">✖ Rubrikler alınamadı</p>
            <p>
              {rubrics.error instanceof ApiError
                ? rubrics.error.message
                : 'Beklenmeyen bir hata oluştu.'}
            </p>
            <button type="button" className="btn mt-3" onClick={() => void rubrics.refetch()}>
              Tekrar dene
            </button>
          </div>
        )}

        {rubrics.isSuccess && !rubric && (
          <div className="card text-center">
            <p className="text-lg font-bold">Bu tür için kayıtlı rubrik yok</p>
            <p className="text-muted">
              {genreLabel(genre)} için bir rubrik yüklendiğinde burada görünür.
            </p>
          </div>
        )}

        {rubric && <RubricView rubric={rubric} />}
      </section>

      <About />
    </div>
  );
}
