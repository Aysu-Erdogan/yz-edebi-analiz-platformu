import { genreLabel } from '../analytics/data';
import { bestIndexes, rawScore, weightPercents, type ComparisonResult } from './data';

const one = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const nameOf = (label: string | null, index: number): string => label ?? `Metin ${index + 1}`;

/** Sonuç: toplam puan kartları, kriter tablosu ve hakemin gerekçeleri. Yüksek puan renkle değil yazıyla da belirtilir. */
export function ResultView({ result }: { result: ComparisonResult }) {
  const names = result.items.map((item, i) => nameOf(item.label, i));
  const totals = result.items.map((i) => (i.status === 'succeeded' ? i.totalScore : null));
  const bestTotal = bestIndexes(totals);
  const weights = weightPercents(result.rubric.criteria);
  const scaleMax = result.rubric.scale.max;

  return (
    <section aria-labelledby="sonuc-baslik" className="space-y-6">
      <div>
        <h2 id="sonuc-baslik" className="text-3xl">
          Sonuç
        </h2>
        <p className="text-muted">
          {genreLabel(result.genre)} · {result.theme} · hakem {result.judge} · rubrik{' '}
          {result.rubric.version}
          {result.totalCostUsd !== null && <> · maliyet ≈ ${usd.format(result.totalCostUsd)}</>}
        </p>
        {result.rubric.version.includes('taslak') && (
          <p className="badge text-warn mt-2">
            ▲ Taslak rubrik ({result.rubric.version}): uzman doğrulaması yok, sonuçlar geçicidir.
          </p>
        )}
      </div>

      <ul
        className={`grid gap-4 ${result.items.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
      >
        {result.items.map((item, i) => (
          <li key={item.textId} className="card-dark">
            <p className="font-bold">{names[i]}</p>
            {item.status === 'succeeded' ? (
              <>
                <b className="block text-4xl leading-tight font-extrabold">
                  {one.format(item.totalScore)}
                  <span className="text-lg font-semibold"> / 100</span>
                </b>
                {bestTotal.includes(i) && result.items.length > 1 && (
                  <p className="mt-1 text-sm font-bold">★ En yüksek toplam puan</p>
                )}
              </>
            ) : (
              <p role="alert" className="mt-2 font-bold">
                ✖ Puanlanamadı
                <span className="block text-sm font-normal">{item.error}</span>
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="card">
        <h3 className="text-xl">Kriter kriter karşılaştırma</h3>
        <p className="text-muted mb-3">
          Puanlar rubrikteki ham ölçektedir (en çok {scaleMax}); kalın yazılan, o kriterde en yüksek
          puandır.
        </p>
        <div className="overflow-x-auto">
          <table className="table-plain">
            <caption className="sr-only">Metinlerin kriter bazında ham puanları</caption>
            <thead>
              <tr>
                <th scope="col">Kriter (ağırlık)</th>
                {names.map((n, i) => (
                  <th key={result.items[i]!.textId} scope="col" className="num">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rubric.criteria.map((criterion, c) => {
                const scores = result.items.map((item) => rawScore(item, criterion.key));
                const best = bestIndexes(scores);
                return (
                  <tr key={criterion.key}>
                    <th scope="row">
                      {criterion.label}{' '}
                      <span className="text-muted text-xs font-normal">
                        (%{pct.format(weights[c]!)})
                      </span>
                    </th>
                    {scores.map((score, i) => (
                      <td key={result.items[i]!.textId} className="num">
                        {score === null ? (
                          <span aria-label="puan yok">-</span>
                        ) : best.includes(i) && result.items.length > 1 ? (
                          <strong>
                            {score} / {scaleMax}
                            <span className="sr-only"> (en yüksek)</span>
                          </strong>
                        ) : (
                          `${score} / ${scaleMax}`
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <th scope="row">Toplam (0-100)</th>
                {totals.map((total, i) => (
                  <td key={result.items[i]!.textId} className="num font-bold">
                    {total === null ? '-' : one.format(total)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="text-xl">Hakemin gerekçeleri</h3>
        <div className="mt-3 space-y-2">
          {result.items.map((item, i) =>
            item.status === 'succeeded' ? (
              <details key={item.textId}>
                <summary className="cursor-pointer font-semibold">{names[i]}</summary>
                <dl className="mt-2 space-y-2 pl-4">
                  {result.rubric.criteria.map((criterion) => {
                    const scored = item.scores.find((s) => s.key === criterion.key);
                    return scored ? (
                      <div key={criterion.key}>
                        <dt className="font-semibold">
                          {criterion.label}: {scored.score} / {scaleMax}
                        </dt>
                        <dd>{scored.comment}</dd>
                      </div>
                    ) : null;
                  })}
                </dl>
              </details>
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}
