import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

/**
 * AnalysisChart - Metin analiz metriklerini görselleştiren bileşen
 * @param {Object} props
 * @param {string} props.chartType - 'Pasta Grafik' | 'Çubuk Grafik' | 'Çizgi Grafik'
 * @param {Array} props.metinler - Metin alanları verisi [{ alan, metin, model }]
 * @param {string} props.aiMetin - AI üretilen metin
 * @param {string} props.tema - Seçilen tema
 * @param {string} props.tur - Seçilen tür
 */
export default function AnalysisChart({ chartType, metinler, aiMetin, tema, tur }) {
  // Metin verilerinden metrikler hesapla
  const metrics = useMemo(() => {
    const hesapla = (metin) => {
      if (!metin || !metin.trim()) return { kelimeSayisi: 0, karakterSayisi: 0, cumleSayisi: 0, ortalamaKelimeUzunlugu: 0 };
      const kelimeler = metin.trim().split(/\s+/).filter(Boolean);
      const cumleler = metin.split(/[.!?]+/).filter(s => s.trim()).length;
      const toplamKarakter = kelimeler.join('').length;
      return {
        kelimeSayisi: kelimeler.length,
        karakterSayisi: metin.length,
        cumleSayisi: cumleler || 1,
        ortalamaKelimeUzunlugu: kelimeler.length ? (toplamKarakter / kelimeler.length).toFixed(1) : 0,
      };
    };

    return metinler
      .filter(m => m.metin && m.metin.trim())
      .map(m => ({
        label: `${m.alan} (${m.model})`,
        ...hesapla(m.metin),
      }));
  }, [metinler]);

  // AI metni için metrik
  const aiMetrics = useMemo(() => {
    if (!aiMetin || !aiMetin.trim()) return null;
    const kelimeler = aiMetin.trim().split(/\s+/).filter(Boolean);
    const cumleler = aiMetin.split(/[.!?]+/).filter(s => s.trim()).length;
    const toplamKarakter = kelimeler.join('').length;
    return {
      label: 'Gemini (AI)',
      kelimeSayisi: kelimeler.length,
      karakterSayisi: aiMetin.length,
      cumleSayisi: cumleler || 1,
      ortalamaKelimeUzunlugu: kelimeler.length ? (toplamKarakter / kelimeler.length).toFixed(1) : 0,
    };
  }, [aiMetin]);

  // Tüm veri setlerini birleştir
  const allData = useMemo(() => {
    const data = [...metrics];
    if (aiMetrics) data.push(aiMetrics);
    return data;
  }, [metrics, aiMetrics]);

  // Chart.js veri formatı
  const chartData = useMemo(() => {
    if (allData.length === 0) return null;

    const labels = allData.map(d => d.label);
    const datasets = [
      {
        label: 'Kelime Sayısı',
        data: allData.map(d => d.kelimeSayisi),
        backgroundColor: [
          'rgba(59, 130, 246, 0.7)',
          'rgba(16, 185, 129, 0.7)',
          'rgba(245, 158, 11, 0.7)',
          'rgba(139, 92, 246, 0.7)',
        ],
        borderColor: [
          'rgb(59, 130, 246)',
          'rgb(16, 185, 129)',
          'rgb(245, 158, 11)',
          'rgb(139, 92, 246)',
        ],
        borderWidth: 2,
        borderRadius: 6,
      },
      {
        label: 'Cümle Sayısı',
        data: allData.map(d => d.cumleSayisi),
        backgroundColor: [
          'rgba(239, 68, 68, 0.7)',
          'rgba(236, 72, 153, 0.7)',
          'rgba(6, 182, 212, 0.7)',
          'rgba(34, 197, 94, 0.7)',
        ],
        borderColor: [
          'rgb(239, 68, 68)',
          'rgb(236, 72, 153)',
          'rgb(6, 182, 212)',
          'rgb(34, 197, 94)',
        ],
        borderWidth: 2,
        borderRadius: 6,
      },
    ];

    return { labels, datasets };
  }, [allData]);

  // Pasta grafik için veri (sadece kelime sayısı)
  const pieData = useMemo(() => {
    if (allData.length === 0) return null;
    return {
      labels: allData.map(d => d.label),
      datasets: [{
        data: allData.map(d => d.kelimeSayisi),
        backgroundColor: [
          'rgba(59, 130, 246, 0.8)',
          'rgba(16, 185, 129, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(139, 92, 246, 0.8)',
        ],
        borderColor: [
          'rgb(59, 130, 246)',
          'rgb(16, 185, 129)',
          'rgb(245, 158, 11)',
          'rgb(139, 92, 246)',
        ],
        borderWidth: 2,
      }],
    };
  }, [allData]);

  // Ortak seçenekler
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true,
          font: { size: 12 },
        },
      },
      title: {
        display: true,
        text: `Edebi Metin Analizi: ${tema} / ${tur}`,
        font: { size: 16, weight: 'bold' },
        padding: { bottom: 20 },
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleFont: { size: 13 },
        bodyFont: { size: 12 },
        callbacks: {
          label: (context) => {
            const data = allData[context.dataIndex];
            if (!data) return '';
            return [
              `${context.dataset.label}: ${context.raw}`,
              `Kelime: ${data.kelimeSayisi} | Cümle: ${data.cumleSayisi} | Ort. Kelime Uz.: ${data.ortalamaKelimeUzunlugu}`,
            ];
          },
        },
      },
    },
  };

  const barOptions = {
    ...commonOptions,
    indexAxis: 'y',
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.05)' },
      },
      y: {
        grid: { display: false },
      },
    },
  };

  const lineOptions = {
    ...commonOptions,
    scales: {
      x: { grid: { color: 'rgba(0,0,0,0.05)' } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
    },
    elements: {
      line: { tension: 0.3 },
      point: { radius: 6, hoverRadius: 8 },
    },
  };

  const pieOptions = {
    ...commonOptions,
    cutout: '60%',
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          label: (context) => {
            const data = allData[context.dataIndex];
            if (!data) return '';
            const total = allData.reduce((sum, d) => sum + d.kelimeSayisi, 0);
            const percent = ((data.kelimeSayisi / total) * 100).toFixed(1);
            return [
              `${context.label}: ${data.kelimeSayisi} kelime (${percent}%)`,
              `Cümle: ${data.cumleSayisi} | Ort. Kelime Uz.: ${data.ortalamaKelimeUzunlugu}`,
            ];
          },
        },
      },
    },
  };

  if (!chartData || allData.length === 0) {
    return (
      <div className="chart-empty">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 21H3v-18h18" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 16l4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p>Henüz veri yok. Metin girip "Karşılaştır" butonuna basın.</p>
      </div>
    );
  }

  // Grafik türüne göre render
  switch (chartType) {
    case 'Pasta Grafik':
      return (
        <div className="chart-wrapper" style={{ height: '350px' }}>
          <Doughnut data={pieData} options={pieOptions} />
        </div>
      );
    case 'Çubuk Grafik':
      return (
        <div className="chart-wrapper" style={{ height: '350px' }}>
          <Bar data={chartData} options={barOptions} />
        </div>
      );
    case 'Çizgi Grafik':
      return (
        <div className="chart-wrapper" style={{ height: '350px' }}>
          <Line data={chartData} options={lineOptions} />
        </div>
      );
    default:
      return (
        <div className="chart-wrapper" style={{ height: '350px' }}>
          <Bar data={chartData} options={barOptions} />
        </div>
      );
  }
}