import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Analysis } from './pages/Analysis';
import { Compare } from './pages/Compare';
import { Placeholder } from './pages/Placeholder';
import { RubricPage } from './pages/Rubric';

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
        <Route index element={<Compare />} />
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
        <Route path="rubrik" element={<RubricPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
