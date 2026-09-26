/** Default-deny legacy route. No credential is read until this opt-in passes. */
export function nonIndiaProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ULPIN_ALLOW_NON_INDIA_PROVIDER === '1' && env.ULPIN_RELEASE_PROFILE !== 'finale_v1';
}
export function assertNonIndiaProviderAllowed(): void {
  if (!nonIndiaProviderAllowed()) throw new Error('AI_PROVIDER_POLICY: Non-India provider access is disabled. Native preparation remains available.');
}
