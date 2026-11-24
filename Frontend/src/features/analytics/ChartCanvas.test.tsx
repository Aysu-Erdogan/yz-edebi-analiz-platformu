import type { ChartConfiguration } from 'chart.js';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartCanvas } from './ChartCanvas';

const { instances } = vi.hoisted(() => ({
  instances: [] as { config: unknown; destroy: () => void }[],
}));

// Gerçek Chart.js canvas'a çizer; burada yalnızca sarmalayıcının yaşam döngüsü sınanır.
vi.mock('chart.js', () => {
  class Chart {
    static register = vi.fn();
    static defaults = { font: {}, color: '' };
    destroy = vi.fn();
    constructor(
      _canvas: unknown,
      public config: unknown,
    ) {
      instances.push(this);
    }
  }
  const part = {};
  return {
    Chart,
    BarController: part,
    BarElement: part,
    CategoryScale: part,
    LinearScale: part,
    RadarController: part,
    RadialLinearScale: part,
    PointElement: part,
    LineElement: part,
    Filler: part,
    Tooltip: part,
  };
});

const cfg = (title: string): ChartConfiguration => ({
  type: 'bar',
  data: { labels: [title], datasets: [] },
});

describe('ChartCanvas', () => {
  it('canvas ekran okuyucuya etiketli bir görsel olarak sunulur', () => {
    render(<ChartCanvas config={cfg('a')} label="Örnek grafik" />);
    expect(screen.getByRole('img', { name: 'Örnek grafik' }).tagName).toBe('CANVAS');
  });

  it('yapılandırmayla grafik kurar, kaldırılınca yok eder (bellek sızıntısı olmaz)', () => {
    instances.length = 0;
    const config = cfg('a');
    const { unmount } = render(<ChartCanvas config={config} label="x" />);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.config).toBe(config);
    unmount();
    expect(instances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('yapılandırma değişince eskisini yok edip yenisini kurar', () => {
    instances.length = 0;
    const { rerender } = render(<ChartCanvas config={cfg('a')} label="x" />);
    rerender(<ChartCanvas config={cfg('b')} label="x" />);
    expect(instances).toHaveLength(2);
    expect(instances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(instances[1]!.destroy).not.toHaveBeenCalled();
  });
});
