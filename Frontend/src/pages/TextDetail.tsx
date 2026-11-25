import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { genreLabel } from '../features/analytics/data';
import {
  SOURCE_LABEL,
  writerName,
  type TextDetail as TextDetailData,
} from '../features/library/data';
import { EvaluationsView } from '../features/library/EvaluationsView';
import { ApiError, apiRequest } from '../lib/api';

const date = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' });
const seconds = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('tr-TR');

const Back = () => (
  <Link to="/uretim" className="inline-block font-semibold">
    ← Kütüphaneye dön
  </Link>
);

export function TextDetail() {
  const { id = '' } = useParams();
  // Yalnızca pozitif tam sayı; başka bir değer için sunucuya gidilmez.
  const valid = /^[1-9]\d*$/.test(id);
  const text = useQuery({
    queryKey: ['text', id],
    queryFn: () => apiRequest<TextDetailData>(`/texts/${id}`),
    enabled: valid,
  });

  if (!valid) {
    return (
      <section className="space-y-4 py-10 text-center">
        <h1 className="text-4xl">Geçersiz metin kimliği</h1>
        <p className="text-muted">Metin kimliği pozitif bir sayı olmalı.</p>
        <Back />
      </section>
    );
  }

  if (text.isPending) return <p role="status">Metin yükleniyor…</p>;

  if (text.isError) {
    const notFound = text.error instanceof ApiError && text.error.code === 'NOT_FOUND';
    return (
      <section className="space-y-4 py-10 text-center">
        <h1 className="text-4xl">{notFound ? 'Metin bulunamadı' : 'Metin alınamadı'}</h1>
        <p role="alert" className="text-muted">
          {text.error instanceof ApiError ? text.error.message : 'Beklenmeyen bir hata oluştu.'}
        </p>
        {!notFound && (
          <button type="button" className="btn" onClick={() => void text.refetch()}>
            Tekrar dene
          </button>
        )}
        <p>
          <Back />
        </p>
      </section>
    );
  }

  const t = text.data;
  const g = t.generation;

  return (
    <div className="space-y-8">
      <Back />

      <section aria-labelledby="sayfa-baslik" className="space-y-2">
        <h1 id="sayfa-baslik" className="text-4xl sm:text-5xl">
          Metin #{t.id}
        </h1>
        <p className="text-muted text-lg">
          {genreLabel(t.genre)} · {t.theme} · {writerName(t)} · {SOURCE_LABEL[t.source]} ·{' '}
          {t.wordCount} sözcük · {date.format(new Date(t.createdAt))}
        </p>
      </section>

      <article aria-label="Metin" className="card">
        {/* Şiir serif italik (ADR 0008); düzyazı okunurluk için italik değil. Satır sonları korunur. */}
        <p
          className={`max-w-3xl font-serif text-2xl leading-relaxed whitespace-pre-wrap ${
            t.genre === 'siir' ? 'italic' : ''
          }`}
        >
          {t.body}
        </p>
      </article>

      {g && (
        <p className="text-muted">
          Üretim: komut {g.templateVersion} · tekrar {g.replicateNo}
          {g.inputTokens !== null && g.outputTokens !== null && (
            <>
              {' '}
              · {count.format(g.inputTokens)} giriş + {count.format(g.outputTokens)} çıkış token
            </>
          )}
          {g.latencyMs !== null && <> · {seconds.format(g.latencyMs / 1000)} sn</>}
        </p>
      )}

      <section aria-labelledby="puanlama-baslik" className="space-y-4">
        <h2 id="puanlama-baslik" className="text-3xl">
          Puanlamalar
        </h2>
        <EvaluationsView evaluations={t.evaluations} />
      </section>
    </div>
  );
}
