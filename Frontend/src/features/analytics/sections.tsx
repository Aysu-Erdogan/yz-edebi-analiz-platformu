import { ScrollRegion } from '../../components/ScrollRegion';
import { useMemo } from 'react';
import { barConfig, modelStyle, radarConfig } from './charts';
import { ChartCanvas } from './ChartCanvas';
import {
  authorsOf,
  genreLabel,
  heatAlpha,
  heatTable,
  modelName,
  rubricLookup,
  scopeLabel,
  type Comparison,
  type Condition,
  type HeatTable,
  type Profile,
  type RubricLite,
} from './data';

const one = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const two = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const four = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Model adı ve işareti: renge ek olarak şekil (●■▲) ile de ayırt edilir. */
export function ModelLegend({ authors }: { authors: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Modeller">
      {authors.map((a, i) => (
        <li key={a} className="flex items-center gap-1.5">
          <span aria-hidden="true" style={{ color: modelStyle(i).color }}>
            {modelStyle(i).mark}
          </span>
          {modelName(a)}
        </li>
      ))}
    </ul>
  );
}

/** Model × tür (ya da tema) ortalama puan tablosu; hücre koyuluğu ikincildir, sayı her zaman yazılıdır. */
export function HeatTableView({ heat, caption }: { heat: HeatTable; caption: string }) {
  return (
    <ScrollRegion label={caption}>
      <table className="table-plain">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Model</th>
            {heat.columns.map((c) => (
              <th key={c.key} scope="col" className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heat.rows.map((row) => (
            <tr key={row.author}>
              <th scope="row">{modelName(row.author)}</th>
              {row.cells.map((cell, i) => (
                <td
                  key={heat.columns[i]!.key}
                  className="num"
                  style={
                    cell
                      ? {
                          backgroundColor: `rgb(53 40 30 / ${heatAlpha(cell.mean, heat.min, heat.max)})`,
                        }
                      : undefined
                  }
                >
                  {cell ? (
                    <>
                      <strong>{one.format(cell.mean)}</strong>
                      <span className="text-xs"> (n {cell.n})</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">-</span>
                      <span className="sr-only">veri yok</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** Tür başına gruplu çubuk grafiği. Aynı değerler, yukarıdaki model × tür tablosunda yazılıdır. */
export function BarSection({ condition }: { condition: Condition }) {
  const heat = useMemo(() => heatTable(condition, 'tür '), [condition]);
  const config = useMemo(() => barConfig(heat), [heat]);
  if (heat.columns.length === 0) return null;
  return (
    <section className="card" aria-labelledby="cubuk-baslik">
      <h2 id="cubuk-baslik" className="text-2xl">
        Türe göre model karşılaştırması
      </h2>
      <ModelLegend authors={authorsOf(condition)} />
      <ChartCanvas
        config={config}
        label="Gruplu çubuk grafik: her tür için modellerin ortalama puanı. Aynı değerler yukarıdaki tabloda yazılıdır."
      />
    </section>
  );
}

function RadarCard({
  profile,
  authors,
  rubrics,
  version,
}: {
  profile: Profile;
  authors: string[];
  rubrics: RubricLite[] | undefined;
  version: string;
}) {
  const genre = profile.kapsam.replace(/^tür /, '');
  const { label, scaleMax } = rubricLookup(rubrics, genre, version);
  const config = useMemo(
    () => radarConfig(profile, authors, label, scaleMax),
    // `label` her çizimde yeni işlev; rubrik listesi değişmedikçe grafiği yeniden kurmamak için bağımlılık dışı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, authors, rubrics, version],
  );
  return (
    <div>
      <h3 className="text-lg">{genreLabel(genre)}: kriter profili</h3>
      <ChartCanvas
        config={config}
        label={`Radar grafik, ${genreLabel(genre)}: modellerin kriter başına ortalama ham puanı. Aynı değerler grafiğin altındaki tabloda yazılıdır.`}
      />
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">Tablo olarak göster</summary>
        <ScrollRegion
          label={`${genreLabel(genre)}: kriter başına ortalama ham puan`}
          className="mt-2"
        >
          <table className="table-plain">
            <caption className="sr-only">
              {genreLabel(genre)}: kriter başına ortalama ham puan (rubrik ölçeği, en çok {scaleMax}
              )
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                {profile.kriterler.map((k) => (
                  <th key={k} scope="col" className="num">
                    {label(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.gruplar.map((g) => (
                <tr key={g.anahtar}>
                  <th scope="row">{modelName(g.anahtar)}</th>
                  {profile.kriterler.map((k) => (
                    <td key={k} className="num">
                      {g.ortalamalar[k] === undefined ? '-' : two.format(g.ortalamalar[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </details>
    </div>
  );
}

/** Her tür için bir radar grafiği (kriterler türe göre farklıdır, bu yüzden tür başına ayrı). */
export function RadarSection({
  condition,
  rubrics,
}: {
  condition: Condition;
  rubrics: RubricLite[] | undefined;
}) {
  const authors = useMemo(() => authorsOf(condition), [condition]);
  if (condition.profiller.length === 0) return null;
  return (
    <section className="card" aria-labelledby="radar-baslik">
      <h2 id="radar-baslik" className="text-2xl">
        Kriter profili
      </h2>
      <p className="text-muted mb-4">
        Kriter puanları rubrikteki ham ölçektedir (0-100 değil); her model için metinlerin
        ortalaması.
      </p>
      <ModelLegend authors={authors} />
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        {condition.profiller.map((p) => (
          <RadarCard
            key={p.kapsam}
            profile={p}
            authors={authors}
            rubrics={rubrics}
            version={condition.rubrikSurumu}
          />
        ))}
      </div>
    </section>
  );
}

function ComparisonView({ cmp }: { cmp: Comparison }) {
  const kw = cmp.kruskalWallis;
  return (
    <div className="mt-6">
      <h3 className="text-lg">{scopeLabel(cmp.kapsam)}</h3>
      <ScrollRegion label={`${scopeLabel(cmp.kapsam)}: model başına betimsel değerler`}>
        <table className="table-plain">
          <caption className="sr-only">
            {scopeLabel(cmp.kapsam)}: model başına betimsel değerler
          </caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col" className="num">
                n
              </th>
              <th scope="col" className="num">
                Ortalama
              </th>
              <th scope="col" className="num">
                Ortanca
              </th>
              <th scope="col" className="num">
                Std. sapma
              </th>
              <th scope="col" className="num">
                En düşük
              </th>
              <th scope="col" className="num">
                En yüksek
              </th>
            </tr>
          </thead>
          <tbody>
            {cmp.gruplar.map((g) => (
              <tr key={g.anahtar}>
                <th scope="row">{modelName(g.anahtar)}</th>
                <td className="num">{g.n}</td>
                <td className="num">{one.format(g.ortalama)}</td>
                <td className="num">{one.format(g.ortanca)}</td>
                <td className="num">{g.sd === null ? '-' : one.format(g.sd)}</td>
                <td className="num">{one.format(g.enDusuk)}</td>
                <td className="num">{one.format(g.enYuksek)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>

      {kw && (
        <p className="mt-3">
          <strong>Kruskal-Wallis:</strong> H = {two.format(kw.h)} · sd = {kw.sd} · p ={' '}
          {four.format(kw.p)} · ε² = {two.format(kw.epsilonKare)}
        </p>
      )}

      {cmp.ikililer.length > 0 && (
        <ScrollRegion label={`${scopeLabel(cmp.kapsam)}: ikili karşılaştırmalar`} className="mt-3">
          <table className="table-plain">
            <caption className="sr-only">{scopeLabel(cmp.kapsam)}: ikili karşılaştırmalar</caption>
            <thead>
              <tr>
                <th scope="col">Model çifti (Mann-Whitney U)</th>
                <th scope="col" className="num">
                  p
                </th>
                <th scope="col" className="num">
                  p (Holm)
                </th>
                <th scope="col" className="num">
                  Cliff δ
                </th>
                <th scope="col">Test</th>
              </tr>
            </thead>
            <tbody>
              {cmp.ikililer.map((p) => (
                <tr key={`${p.a}|${p.b}`}>
                  <th scope="row">
                    {modelName(p.a)} ↔ {modelName(p.b)}
                  </th>
                  <td className="num">{four.format(p.p)}</td>
                  <td className="num">{four.format(p.pHolm)}</td>
                  <td className="num">{two.format(p.cliffDelta)}</td>
                  <td>{p.tam ? 'tam' : 'yaklaşık'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {cmp.notlar.map((note) => (
        <p key={note} className="badge text-warn mt-3">
          ▲ {note}
        </p>
      ))}
    </div>
  );
}

/** Kruskal-Wallis ve ikili testler. Eşik ya da "anlamlı" yargısı yoktur: ham değerler gösterilir. */
export function StatsSection({ condition }: { condition: Condition }) {
  return (
    <section className="card" aria-labelledby="istatistik-baslik">
      <h2 id="istatistik-baslik" className="text-2xl">
        İstatistiksel karşılaştırma
      </h2>
      <p className="text-muted">
        Ölçüm birimi metindir (aynı metnin tekrarları ortalanır). p değerleri ham ve Holm düzeltmeli
        verilir; anlamlılık eşiği uygulanmaz.
      </p>
      {condition.karsilastirmalar.map((cmp) => (
        <ComparisonView key={cmp.kapsam} cmp={cmp} />
      ))}
    </section>
  );
}
