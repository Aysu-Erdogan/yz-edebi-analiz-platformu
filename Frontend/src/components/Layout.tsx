import { NavLink, Outlet } from 'react-router-dom';
import { HealthStatus } from '../features/health/HealthStatus';

const NAV_ITEMS = [
  { to: '/', label: 'Karşılaştır', end: true },
  { to: '/uretim', label: 'Üretim ve Kütüphane', end: false },
  { to: '/analiz', label: 'Sonuçlar ve Analiz', end: false },
  { to: '/rubrik', label: 'Rubrik ve Hakkında', end: false },
] as const;

export function Layout() {
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

      <main id="icerik" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
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
