/** Starts the local data layer in development only. The production build never includes MSW. */
export async function startLocalData(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_LOCAL_DATA === 'off') return;
  const [{ setupWorker }, { handlers }] = await Promise.all([import('msw/browser'), import('./handlers')]);
  await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass', quiet: true });
}
