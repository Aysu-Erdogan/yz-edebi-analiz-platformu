import { weightPercents } from '../compare/data';
import { genreLabel } from '../analytics/data';
import { STATUS_LABEL, normalizedScore, type Rubric } from './data';

const pct = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** Bir rubriğin tamamı: durum, kaynak notu, ölçek ve her kriterin ağırlığı ile düzey açıklamaları. */
export function RubricView({ rubric }: { rubric: Rubric }) {
  const weights = weightPercents(rubric.criteria);
  const { min, max } = rubric.scale;
  const isDraft = rubric.version.includes('taslak') || rubric.status === 'draft';

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl">
          {genreLabel(rubric.genre)} rubriği · sürüm {rubric.version}{' '}
          <span className="badge text-base">{STATUS_LABEL[rubric.status]}</span>
        </h3>
        {rubric.sourceNote && (
          <p
            className={
              isDraft ? 'text-warn border-warn mt-2 rounded-xl border p-3 font-bold' : 'mt-2'
            }
          >
            {isDraft && '▲ '}
            {rubric.sourceNote}
          </p>
        )}
        <p className="text-muted mt-2">
          Her kriter {min} ile {max} arasında ham puanlanır. Toplam puan, ağırlıklı ortalamanın
          0-100 ölçeğine çevrilmiş halidir: en düşük puan 0, en yüksek puan 100, aradakiler eşit
          aralıklıdır.
        </p>
      </div>

      <ul className="space-y-4">
        {rubric.criteria.map((criterion, i) => (
          <li key={criterion.key} className="card">
            <h4 className="text-xl font-bold">
              {criterion.label}{' '}
              <span className="text-muted text-base font-semibold">
                (ağırlık %{pct.format(weights[i]!)})
              </span>
            </h4>
            <p className="text-muted mb-3">{criterion.description}</p>
            <div className="overflow-x-auto">
              <table className="table-plain">
                <caption className="sr-only">{criterion.label}: puan düzeyleri</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Puan
                    </th>
                    <th scope="col" className="num whitespace-nowrap">
                      0-100
                    </th>
                    <th scope="col">Düzey açıklaması</th>
                  </tr>
                </thead>
                <tbody>
                  {criterion.levels.map((level) => (
                    <tr key={level.score}>
                      <td className="num font-bold">{level.score}</td>
                      <td className="num">
                        {pct.format(normalizedScore(level.score, rubric.scale))}
                      </td>
                      <td>{level.descriptor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
