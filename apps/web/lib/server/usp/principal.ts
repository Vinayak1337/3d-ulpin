import type { RequestContext } from '@ulpin/contracts/usp';
import { AppError } from '../errors';

const local = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function assertLocalRequest(request: Request) {
  if (!local(new URL(request.url).hostname)) {
    throw new AppError(403, 'LOCAL_DEMO_ONLY', 'This single-operator demonstration is available only on localhost.');
  }
  const origin = request.headers.get('origin');
  if (origin) {
    let valid = false;
    try { valid = local(new URL(origin).hostname); } catch { /* malformed or opaque */ }
    if (!valid) throw new AppError(403, 'ORIGIN_DENIED', 'The request did not originate from the local workbench.');
  }
}

/** F1-min principal is derived by the guarded server route, never accepted from JSON/headers. */
export function localRequestContext(requestId: string): RequestContext {
  return { requestId, principal: { subject: 'local-demo-operator', roles: ['operator'],
    entitlementVersion: 'local-1', mode: 'local_demo' },
    accessViewId: 'local-demo-view-1', policyVersion: 'usp-local-1' };
}
