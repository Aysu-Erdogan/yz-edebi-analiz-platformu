import { useQuery } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../../lib/api';

interface HealthData {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: { database: 'up' | 'down' | 'unconfigured' };
}

type View = { tone: 'ok' | 'warn' | 'bad'; label: string };

const TONE_CLASS: Record<View['tone'], string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
};

function describe(isPending: boolean, error: unknown, data: HealthData | undefined): View {
  if (isPending) return { tone: 'warn', label: 'Sunucu durumu denetleniyor…' };
  if (error) {
    if (error instanceof ApiError && error.isNetworkError) {
      return { tone: 'bad', label: 'Sunucuya ulaşılamıyor' };
    }
    if (error instanceof ApiError && error.code === 'SERVICE_UNAVAILABLE') {
      return { tone: 'warn', label: 'Sunucu çalışıyor, veritabanına ulaşılamıyor' };
    }
    return { tone: 'bad', label: 'Sunucu durumu alınamadı' };
  }
  if (data?.checks.database === 'unconfigured') {
    return {
      tone: 'warn',
      label: `Sunucu çalışıyor (veritabanı yapılandırılmamış) · v${data.version}`,
    };
  }
  return { tone: 'ok', label: `Sunucu çalışıyor · v${data?.version ?? '?'}` };
}

/** Sayfa altında backend ve veritabanı durumunu gösterir (uçtan uca bağlantının kanıtı). */
export function HealthStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiRequest<HealthData>('/health'),
    refetchInterval: 30_000,
  });

  const view = describe(isPending, error, data);

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_CLASS[view.tone]}`}
      />
      {view.label}
    </p>
  );
}
