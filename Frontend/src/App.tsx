import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Analysis } from './pages/Analysis';
import { Placeholder } from './pages/Placeholder';

function NotFound() {
  return (
    <section className="py-10 text-center">
      <h1 className="text-4xl sm:text-5xl">Sayfa bulunamadı</h1>
      <p className="text-muted mt-3 text-lg">Aradığınız sayfa yok ya da taşınmış olabilir.</p>
      <Link to="/" className="btn btn-primary mt-6">
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
        <Route path="analiz" element={<Analysis />} />
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
