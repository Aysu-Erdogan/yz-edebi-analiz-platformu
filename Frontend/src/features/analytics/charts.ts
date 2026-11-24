import type { ChartConfiguration } from 'chart.js';
import { modelName, type HeatTable, type Profile } from './data';

/**
 * Chart.js yapılandırmaları. Modeller yalnızca renkle değil işaret (●■▲) ve desenle de ayrılır
 * (renk körlüğü, ADR 0008). Renkler CSS değişkenlerinden okunur: tasarım tek yerde (index.css) kalır.
 * shortcut: üç model biçimi var, dördüncü yazardan itibaren biçimler başa sarar; model sayısı artarsa genişletilir.
 */

export interface ModelStyle {
  color: string;
  mark: string;
  pointStyle: 'circle' | 'rect' | 'triangle';
  pattern: 'none' | 'hatch' | 'dots';
}

const STYLES = [
  {
    cssVar: '--color-model-1',
    fallback: '#b84f00',
    mark: '●',
    pointStyle: 'circle',
    pattern: 'none',
  },
  {
    cssVar: '--color-model-2',
    fallback: '#00785a',
    mark: '■',
    pointStyle: 'rect',
    pattern: 'hatch',
  },
  {
    cssVar: '--color-model-3',
    fallback: '#a8508a',
    mark: '▲',
    pointStyle: 'triangle',
    pattern: 'dots',
  },
] as const;

const cssVar = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function modelStyle(index: number): ModelStyle {
  const s = STYLES[index % STYLES.length]!;
  return {
    color: cssVar(s.cssVar, s.fallback),
    mark: s.mark,
    pointStyle: s.pointStyle,
    pattern: s.pattern,
  };
}

/** Çubuk dolgusu: model 1 düz renk, diğerleri kum zemin üstüne çizgi ya da nokta deseni. */
function fill(style: ModelStyle): string | CanvasPattern {
  if (style.pattern === 'none') return style.color;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 10;
  const g = tile.getContext('2d');
  if (!g) return style.color;
  g.fillStyle = cssVar('--color-page', '#e2e0d8');
  g.fillRect(0, 0, 10, 10);
  g.strokeStyle = g.fillStyle = style.color;
  g.lineWidth = 2;
  if (style.pattern === 'hatch') {
    g.beginPath();
    g.moveTo(0, 10);
    g.lineTo(10, 0);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(5, 5, 2, 0, Math.PI * 2);
    g.fill();
  }
  return g.createPattern(tile, 'repeat') ?? style.color;
}

/** Tür başına gruplu çubuk: her model bir seri (0–100 ölçeği). */
export function barConfig(heat: HeatTable): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: heat.columns.map((c) => c.label),
      datasets: heat.rows.map((row, i) => {
        const style = modelStyle(i);
        return {
          label: modelName(row.author),
          data: row.cells.map((c) => c?.mean ?? null),
          backgroundColor: fill(style),
          borderColor: style.color,
          borderWidth: 2,
        };
      }),
    },
    options: {
      animation: false,
      scales: { y: { min: 0, max: 100, title: { display: true, text: 'Ortalama puan (0-100)' } } },
      plugins: { legend: { display: false } },
    },
  };
}

/** Bir türdeki kriter profili: her model bir çokgen, eksenler kriterler (ham puan, rubrik ölçeği). */
export function radarConfig(
  profile: Profile,
  authors: string[],
  labelOf: (key: string) => string,
  scaleMax: number,
): ChartConfiguration<'radar'> {
  return {
    type: 'radar',
    data: {
      labels: profile.kriterler.map(labelOf),
      datasets: profile.gruplar.map((g) => {
        const style = modelStyle(Math.max(0, authors.indexOf(g.anahtar)));
        return {
          label: modelName(g.anahtar),
          data: profile.kriterler.map((k) => g.ortalamalar[k] ?? null),
          borderColor: style.color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointStyle: style.pointStyle,
          pointRadius: 4,
          pointBackgroundColor: style.color,
        };
      }),
    },
    options: {
      animation: false,
      scales: { r: { min: 0, max: scaleMax, ticks: { stepSize: 1 } } },
      plugins: { legend: { display: false } },
    },
  };
}
