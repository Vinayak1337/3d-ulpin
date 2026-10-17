import { localLayerOn } from './routes';

/**
 * Starts the local data layer in development or an explicitly selected hosted demonstration build.
 * Ordinary production builds exclude it. Hosted defaults never overwrite a visitor's existing work.
 *
 * The service worker (MSW) is preferred because it also answers plain fetches and navigations. Some
 * embedded browsers refuse service workers; then the same route table answers through a fetch wrapper,
 * so the Studio never renders blank because the local layer could not start.
 */
export async function startLocalData(): Promise<void> {
  const hosted = import.meta.env.VITE_HOSTED_DEMO === '1';
  if (!localLayerOn) return;
  // `?reset-session` starts the workstation over: no imports, no reviews, codes or cards.
  const url = new URL(window.location.href);
  if (url.searchParams.has('reset-session')) {
    const { resetSession } = await import('./session');
    resetSession();
    if (hosted) localStorage.setItem('bhuaayam.hosted-bootstrap', 'manual');
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase('ulpin-studio-workflow'); r.onsuccess = r.onerror = r.onblocked = resolve; });
    url.searchParams.delete('reset-session');
    window.history.replaceState(null, '', url);
  }
  if (hosted && !localStorage.getItem('bhuaayam.session') && !localStorage.getItem('bhuaayam.hosted-bootstrap')) {
    const response = await fetch('/api/demo/bootstrap', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('The hosted datasets are not ready. Please reload shortly.');
    const bootstrap = await response.json();
    const session = bootstrap.session;
    if (bootstrap.version !== 1 || !Number.isFinite(session?.areaStartedAt) || !Number.isFinite(session?.floorsStartedAt)
      || typeof session.areaPackageId !== 'string' || typeof session.floorsImportId !== 'string'
      || !Array.isArray(session.floorsFiles) || !session.floorsFiles.every((name: unknown) => typeof name === 'string')) {
      throw new Error('The hosted dataset manifest is invalid.');
    }
    const { writeSession } = await import('./session');
    writeSession({ areaStartedAt: session.areaStartedAt, floorsStartedAt: session.floorsStartedAt,
      areaPackageId: session.areaPackageId, floorsImportId: session.floorsImportId, floorsFiles: session.floorsFiles });
    localStorage.setItem('bhuaayam.hosted-bootstrap', bootstrap.revision);
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
