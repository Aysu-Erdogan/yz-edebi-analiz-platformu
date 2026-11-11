import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** İstemci hatalarında (4xx) yeniden denemenin anlamı yok, ağ/sunucu hatalarında 2 kez denenir. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}
