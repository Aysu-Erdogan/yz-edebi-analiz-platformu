/** Sahte HTTP: adaptör testlerinde gerçek servise gitmeden cevap taklit eder. */
export interface FakeCall {
  url: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

type Handler = (call: FakeCall) => Response | Promise<Response>;
type FetchInput = Parameters<typeof fetch>[0];

export function fakeFetch(handler: Handler) {
  const calls: FakeCall[] = [];
  const fn = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    // Kütüphaneler isteği ya (adres, ayarlar) ikilisi ya da tek bir Request nesnesi olarak verebilir.
    const request = input instanceof Request ? input : undefined;
    const raw = request ? await request.clone().text() : init?.body;
    const call: FakeCall = {
      url: request ? request.url : String(input),
      headers: new Headers(request ? request.headers : init?.headers),
      body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined,
      signal: init?.signal ?? request?.signal,
    };
    calls.push(call);
    // İptal sinyali gelirse gerçek fetch gibi AbortError ile biter.
    if (call.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return handler(call);
  };
  return { fetch: fn as typeof fetch, calls };
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Hiç cevap vermeyen, yalnızca iptal sinyaliyle biten istek. */
export const hangingResponse = (call: FakeCall): Promise<Response> =>
  new Promise((_, reject) => {
    call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
