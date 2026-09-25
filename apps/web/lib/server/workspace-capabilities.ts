import type { WorkspaceCapabilities } from '../workspace-capabilities';
import { nonIndiaProviderAllowed } from './provider-policy';

/** Reports configuration only; no provider request, credentials or residency attestation. */
export function workspaceCapabilities(env: NodeJS.ProcessEnv = process.env): WorkspaceCapabilities {
  const endpoints = ['DATABASE_URL', 'S3_ENDPOINT', 'GEO_URL', 'REDIS_URL'];
  let runtime: WorkspaceCapabilities['runtime'] = 'loopback-configured';
  for (const key of endpoints) {
    try {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(env[key] ?? '').hostname)) {
        runtime = 'external-configured'; break;
      }
    } catch { runtime = 'unknown'; }
  }
  return { runtime, provider: !nonIndiaProviderAllowed(env) ? 'blocked' : env.NOUS_API_KEY ? 'opted-in' : 'unconfigured',
    providerLocation: 'unverified', fullResidency: 'unverified', imageEgress: 'blocked' };
}
