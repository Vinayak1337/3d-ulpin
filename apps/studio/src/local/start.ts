/**
 * Starts the local data layer in development only. The production build never includes it.
 *
 * The service worker (MSW) is preferred because it also answers plain fetches and navigations. Some
 * embedded browsers refuse service workers; then the same route table answers through a fetch wrapper,
 * so the Studio never renders blank because the local layer could not start.
 */
export async function startLocalData(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_LOCAL_DATA === 'off') return;
  // `?reset-session` starts the workstation over: no imports, no reviews, codes or cards.
  const url = new URL(window.location.href);
  if (url.searchParams.has('reset-session')) {
    const { resetSession } = await import('./session');
    resetSession();
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase('ulpin-studio-workflow'); r.onsuccess = r.onerror = r.onblocked = resolve; });
    url.searchParams.delete('reset-session');
    window.history.replaceState(null, '', url);
  }
  const [{ setupWorker }, { getResponse }, { handlers }] = await Promise.all([import('msw/browser'), import('msw'), import('./handlers')]);
  try {
    await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass', quiet: true });
    return;
  } catch (error) {
    console.warn('[local data] Service worker unavailable; answering local routes through a fetch wrapper.', error);
  }
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const local = await getResponse(handlers, request.clone());
    if (local && local.headers.get('x-msw-intention') !== 'passthrough') return local;
    return original(request);
  };
}
