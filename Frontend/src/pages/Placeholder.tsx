interface PlaceholderProps {
  title: string;
  description: string;
}

/** F3'te gerçek sayfalarla değiştirilecek geçici sayfa iskeleti. */
export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <section
      aria-labelledby="sayfa-baslik"
      className="rounded-lg border border-line bg-surface p-6"
    >
      <h1 id="sayfa-baslik" className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="mt-2 text-muted">{description}</p>
      <p className="mt-4 inline-block rounded bg-brand-50 px-3 py-1 text-sm text-brand-700">
        Bu sayfa yapım aşamasında.
      </p>
    </section>
  );
}
