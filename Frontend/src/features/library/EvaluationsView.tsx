import { modelName } from '../analytics/data';
import { groupEvaluations, type TextEvaluation } from './data';

const one = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Bir metnin puanlamaları, koşula göre (hakem, rubrik sürümü, komut sürümü): kriter × tekrar tablosu, ortalamalar,
 * başarısız tekrarlar ve hakemin gerekçeleri. Farklı koşullar ayrı bloklardır, puanları karıştırılmaz.
 */
export function EvaluationsView({ evaluations }: { evaluations: TextEvaluation[] }) {
  const groups = groupEvaluations(evaluations);

  if (groups.length === 0) {
    return (
      <div className="card text-center">
        <p className="text-lg font-bold">Bu metin henüz puanlanmadı</p>
        <p className="text-muted">
          Puanlama yapıldığında hakemin puanları ve gerekçeleri burada görünür.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const failed = group.replicates.filter((e) => !group.succeeded.includes(e));
        return (
          <article key={group.key} className="card space-y-4">
            <h3 className="text-xl">
              Hakem {modelName(group.judge)} · rubrik {group.rubricVersion}
              {group.templateVersion && <> · komut {group.templateVersion}</>}
            </h3>

            {group.meanTotal !== null ? (
              <p className="text-lg">
                Ortalama toplam puan: <b className="text-2xl">{one.format(group.meanTotal)}</b> /
                100
                <span className="text-muted"> ({group.succeeded.length} başarılı tekrar)</span>
              </p>
            ) : (
              <p className="text-muted">Başarılı puanlama yok.</p>
            )}

            {group.succeeded.length > 0 && (
              <div className="overflow-x-auto">
                <table className="table-plain">
                  <caption className="sr-only">
                    {modelName(group.judge)}, rubrik {group.rubricVersion}: kriter puanları (ham
                    ölçek)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Kriter</th>
                      {group.succeeded.map((e) => (
                        <th key={e.id} scope="col" className="num">
                          Tekrar {e.replicateNo}
                        </th>
                      ))}
                      <th scope="col" className="num">
                        Ortalama
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.criteria.map((criterion) => (
                      <tr key={criterion.key}>
                        <th scope="row">{criterion.label}</th>
                        {group.succeeded.map((e) => (
                          <td key={e.id} className="num">
                            {e.scores.find((s) => s.key === criterion.key)?.score ?? '-'}
                          </td>
                        ))}
                        <td className="num font-bold">{one.format(criterion.mean)}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Toplam (0-100)</th>
                      {group.succeeded.map((e) => (
                        <td key={e.id} className="num font-bold">
                          {one.format(e.totalScore as number)}
                        </td>
                      ))}
                      <td className="num font-bold">{one.format(group.meanTotal as number)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {failed.length > 0 && (
              <ul className="space-y-1">
                {failed.map((e) => (
                  <li key={e.id} className="text-bad font-bold">
                    ✖ Tekrar {e.replicateNo} puanlanamadı
                    {e.error && <span className="font-normal">: {e.error}</span>}
                  </li>
                ))}
              </ul>
            )}

            {group.succeeded.length > 0 && (
              <div className="space-y-2">
                {group.succeeded.map((e) => (
                  <details key={e.id}>
                    <summary className="cursor-pointer font-semibold">
                      Hakemin gerekçeleri: tekrar {e.replicateNo}
                    </summary>
                    <dl className="mt-2 space-y-2 pl-4">
                      {e.scores.map((s) => (
                        <div key={s.key}>
                          <dt className="font-semibold">
                            {s.label}: {s.score}
                          </dt>
                          <dd>{s.comment ?? '(gerekçe yok)'}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
