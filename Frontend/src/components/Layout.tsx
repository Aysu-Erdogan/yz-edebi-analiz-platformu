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
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        İçeriğe geç
      </a>

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-lg font-semibold text-brand-700">YZ Edebi Analiz</span>
          <nav aria-label="Ana menü">
            <ul className="flex flex-wrap gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `rounded px-3 py-2 text-sm font-medium ${
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-ink'
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

      <main id="icerik" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <HealthStatus />
        </div>
      </footer>
    </div>
  );
}
