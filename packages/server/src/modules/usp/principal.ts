import { UspPrincipalSchema, type RequestContext } from '@ulpin/contracts/usp';
import { AppError } from '../../infrastructure/errors';
import { allowedLoopbackHost } from '../../infrastructure/loopback-host';

const local = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function assertLocalRequest(request: Request) {
  if (!allowedLoopbackHost(request.headers.get('host'))) {
    throw new AppError(403, 'HOST_DENIED', 'Forbidden host.');
  }
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

/** Local process provenance only; this configuration does not authenticate a human. */
export function localOperatorSubject(): string {
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  if (!subject || subject.trim() !== subject || subject === 'local-demo-operator'
    || !UspPrincipalSchema.unwrap().shape.subject.safeParse(subject).success) {
    throw new AppError(503, 'LOCAL_OPERATOR_CONFIGURATION',
      'Set ULPIN_LOCAL_OPERATOR_SUBJECT to a valid local process attribution subject (1–256 characters, no surrounding whitespace or ASCII control characters). The historical default cannot be used for new attribution.');
  }
  return subject;
}

/** Derived from server configuration after the loopback guard, never from JSON/headers. */
export function localRequestContext(requestId: string): RequestContext {
  return { requestId, principal: { subject: localOperatorSubject(), roles: ['operator'],
    entitlementVersion: 'local-1', mode: 'local_demo' },
    accessViewId: 'local-demo-view-1', policyVersion: 'usp-local-1' };
}
