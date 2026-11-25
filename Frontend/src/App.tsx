import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Analysis } from './pages/Analysis';
import { Compare } from './pages/Compare';
import { Library } from './pages/Library';
import { RubricPage } from './pages/Rubric';
import { TextDetail } from './pages/TextDetail';

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
        <Route path="uretim" element={<Library />} />
        <Route path="uretim/:id" element={<TextDetail />} />
        <Route path="analiz" element={<Analysis />} />
        <Route path="rubrik" element={<RubricPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
