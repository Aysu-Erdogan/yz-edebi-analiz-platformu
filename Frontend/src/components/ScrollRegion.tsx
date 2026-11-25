import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ScrollRegionProps {
  /** Kutunun içindeki tablonun kısa adı; kaydırılabilir olunca erişilebilir ad olur. */
  label: string;
  /** Ek sınıflar (örn. üst boşluk). */
  className?: string;
  children: ReactNode;
}

/**
 * Yatay kaydırılabilen tablo kutusu. İçerik taşmıyorsa sıradan bir kutudur; taşıyorsa (dar ekran) klavyeyle
 * odaklanabilir ve adlandırılmış bir bölge olur, böylece fare kullanmayan biri taşan sütunlara oklarla
 * ulaşabilir (WCAG 2.1.1). Taşmayan tabloya gereksiz Tab durağı eklenmez.
 */
export function ScrollRegion({ label, className = '', children }: ScrollRegionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  // İçerik değişince yeniden ölçülür (süzgeç ya da veri tablo genişliğini değiştirebilir). `children` her üst
  // çizimde yeni olduğundan fiilen her çizimden sonradır; aynı değer yeniden çizim yaratmaz.
  useEffect(() => {
    const el = ref.current;
    if (el) setScrolls(el.scrollWidth > el.clientWidth + 1);
  }, [children]);

  // Pencere boyutu değişince ölçü yenilenir (döndürme, yeniden boyutlandırma).
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setScrolls(el.scrollWidth > el.clientWidth + 1);
    };
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div
      ref={ref}
      className={`overflow-x-auto ${className}`.trim()}
      {...(scrolls
        ? { tabIndex: 0, role: 'region', 'aria-label': `${label}, kaydırılabilir tablo` }
        : {})}
    >
      {children}
    </div>
  );
}
