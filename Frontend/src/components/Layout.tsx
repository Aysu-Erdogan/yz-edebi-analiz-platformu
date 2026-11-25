import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HealthStatus } from '../features/health/HealthStatus';

const NAV_ITEMS = [
  { to: '/', label: 'Karşılaştır', end: true },
  { to: '/uretim', label: 'Üretim ve Kütüphane', end: false },
  { to: '/analiz', label: 'Sonuçlar ve Analiz', end: false },
  { to: '/rubrik', label: 'Rubrik ve Hakkında', end: false },
] as const;

/** Adresin ait olduğu menü öğesinin adı (alt sayfalar üst sayfanınkini alır); menüde olmayan adres 404'tür. */
function pageTitle(pathname: string): string {
  const item = NAV_ITEMS.find((i) =>
    i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`),
  );
  return item?.label ?? 'Sayfa bulunamadı';
}

export function Layout() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);

  // Tek sayfa uygulamasında sayfa yenilenmez: başlık sayfayı anlatmalı (WCAG 2.4.2) ve sayfa değişince odak
  // içeriğe taşınmalı ki ekran okuyucu ve klavye kullanıcısı yeni sayfayı fark etsin. İlk açılışta odak çalınmaz.
  useEffect(() => {
    document.title = `${pageTitle(pathname)} · YZ Edebi Analiz`;
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#icerik"
        className="bg-page sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:rounded focus:px-3 focus:py-2"
      >
        İçeriğe geç
      </a>

      <header>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <span className="text-base font-bold tracking-[0.14em] uppercase">YZ Edebi Analiz</span>
          <nav aria-label="Ana menü">
            <ul className="flex flex-wrap gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `block border-b-2 px-3 py-2 text-sm no-underline ${
                        isActive
                          ? 'border-accent text-ink font-bold'
                          : 'text-muted hover:text-ink border-transparent'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main
        id="icerik"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 focus:outline-none"
      >
        <Outlet />
      </main>

      <footer className="bg-ink text-page">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <HealthStatus />
        </div>
      </footer>
    </div>
  );
}
