interface PlaceholderProps {
  title: string;
  description: string;
}

/** Gerçek sayfası henüz yazılmamış bölümler için geçici sayfa iskeleti. */
export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <section aria-labelledby="sayfa-baslik" className="py-10 text-center">
      <h1 id="sayfa-baslik" className="text-4xl sm:text-5xl">
        {title}
      </h1>
      <p className="text-muted mx-auto mt-3 max-w-xl text-lg">{description}</p>
      <p className="badge text-muted mt-6">Bu sayfa yapım aşamasında</p>
    </section>
  );
}
