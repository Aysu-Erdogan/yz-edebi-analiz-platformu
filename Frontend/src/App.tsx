import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Placeholder } from './pages/Placeholder';

function NotFound() {
  return (
    <section className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <p className="mt-2 text-muted">Aradığınız sayfa yok ya da taşınmış olabilir.</p>
      <Link to="/" className="mt-4 inline-block text-brand-600 underline">
        Ana sayfaya dön
      </Link>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <Placeholder
              title="Karşılaştır"
              description="Üç metni girin, seçili rubrikle puanlayıp yan yana karşılaştırın."
            />
          }
        />
        <Route
          path="uretim"
          element={
            <Placeholder
              title="Üretim ve Kütüphane"
              description="Modellerden toplu metin üretin, tüm metinleri filtreleyip inceleyin."
            />
          }
        />
        <Route
          path="analiz"
          element={
            <Placeholder
              title="Sonuçlar ve Analiz"
              description="Model, tür ve tema bazında puanları, grafikleri ve istatistikleri görün."
            />
          }
        />
        <Route
          path="rubrik"
          element={
            <Placeholder
              title="Rubrik ve Hakkında"
              description="Kullanılan rubriği, sürümlerini ve projenin yöntemini inceleyin."
            />
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
