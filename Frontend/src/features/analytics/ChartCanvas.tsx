import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip,
} from 'chart.js';
import { useEffect, useRef } from 'react';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
);
Chart.defaults.font.family = "'Inter Variable', 'Inter', system-ui, sans-serif";
Chart.defaults.color = '#35281e';

interface ChartCanvasProps {
  /** Çağıran `useMemo` ile sabit tutar: yapılandırma değişince grafik yeniden çizilir. */
  config: ChartConfiguration;
  /** Ekran okuyucu için grafiğin özeti; aynı veriyi gösteren bir tablo grafiğin yanında bulunur. */
  label: string;
}

export function ChartCanvas({ config, label }: ChartCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const chart = new Chart(canvas, config);
    return () => chart.destroy();
  }, [config]);

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}
