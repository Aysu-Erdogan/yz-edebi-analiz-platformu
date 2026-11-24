import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { genreLabel } from '../features/analytics/data';
import {
  GENRES,
  MAX_BODY_LENGTH,
  SLOT_LETTERS,
  THEMES,
  buildRequest,
  type ComparisonRequest,
  type ComparisonResult,
  type Slot,
} from '../features/compare/data';
import { ResultView } from '../features/compare/ResultView';
import { ApiError, apiRequest } from '../lib/api';

const emptySlots = (): Slot[] => SLOT_LETTERS.map(() => ({ label: '', body: '' }));

const field = 'border-line bg-page w-full rounded-xl border px-3 py-2';

export function Compare() {
  const [genre, setGenre] = useState<string>('siir');
  const [theme, setTheme] = useState<string>(THEMES[0]);
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
  const [formError, setFormError] = useState<string | null>(null);

  // Ücretli çağrı: istek hata verirse sessizce yeniden denenmez (mutation varsayılanı: deneme yok).
  const compare = useMutation({
    mutationFn: (request: ComparisonRequest) =>
      apiRequest<ComparisonResult>('/comparisons', { method: 'POST', json: request }),
  });

  const setSlot = (index: number, patch: Partial<Slot>) =>
    setSlots((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (compare.isPending) return;
    const request = buildRequest(genre, theme, slots);
    if (request.items.length < 2) {
      setFormError('En az iki metin girin: karşılaştırmak için en az iki metin gerekir.');
      return;
    }
    setFormError(null);
    compare.mutate(request);
  }

  return (
    <div className="space-y-8">
      <section className="py-6 text-center" aria-labelledby="sayfa-baslik">
        <h1 id="sayfa-baslik" className="text-4xl sm:text-5xl">
          Karşılaştır
        </h1>
        <p className="text-muted mx-auto mt-3 max-w-2xl text-lg">
          Aynı komutla yazdırdığınız iki ya da üç metni yapıştırın; sabit yapay zekâ hakem rubrikle
          puanlasın, farkı kriter kriter görün. Hakem, metnin hangi modelden geldiğini görmez.
        </p>
      </section>

      <form onSubmit={submit} noValidate className="space-y-6">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            Tür
            <select
              className={`${field} w-auto`}
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {genreLabel(g)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Tema
            <select
              className={`${field} w-auto`}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {slots.map((slot, i) => {
            const letter = SLOT_LETTERS[i];
            return (
              <div key={letter} className="card space-y-3">
                <h2 className="text-xl">Metin {letter}</h2>
                <div>
                  <label htmlFor={`etiket-${letter}`} className="mb-1 block text-sm font-semibold">
                    Model etiketi (isteğe bağlı)
                  </label>
                  <input
                    id={`etiket-${letter}`}
                    className={field}
                    maxLength={128}
                    placeholder="Örn. ChatGPT"
                    value={slot.label}
                    onChange={(e) => setSlot(i, { label: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`metin-${letter}`} className="mb-1 block text-sm font-semibold">
                    Metin {letter} içeriği
                  </label>
                  <textarea
                    id={`metin-${letter}`}
                    className={`${field} font-serif text-lg`}
                    rows={12}
                    maxLength={MAX_BODY_LENGTH}
                    aria-describedby={`sayac-${letter}`}
                    value={slot.body}
                    onChange={(e) => setSlot(i, { body: e.target.value })}
                  />
                  <p id={`sayac-${letter}`} className="text-muted text-right text-sm">
                    {slot.body.length.toLocaleString('tr-TR')} /{' '}
                    {MAX_BODY_LENGTH.toLocaleString('tr-TR')} karakter
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {formError && (
          <p role="alert" className="text-bad font-bold">
            ✖ {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={compare.isPending}>
            {compare.isPending ? 'Puanlanıyor…' : 'Karşılaştır'}
          </button>
          {compare.isPending && (
            <p role="status">Hakem metinleri puanlıyor, bu işlem birkaç on saniye sürebilir.</p>
          )}
        </div>
      </form>

      {compare.isError && (
        <div role="alert" className="card">
          <p className="text-bad font-bold">✖ Karşılaştırma yapılamadı</p>
          <p>
            {compare.error instanceof ApiError
              ? compare.error.message
              : 'Beklenmeyen bir hata oluştu.'}
          </p>
          <p className="text-muted text-sm">
            Girdiğiniz metinler korundu, tekrar deneyebilirsiniz.
          </p>
        </div>
      )}

      {compare.isSuccess && <ResultView result={compare.data} />}
    </div>
  );
}
