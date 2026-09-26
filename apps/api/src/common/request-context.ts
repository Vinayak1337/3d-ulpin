import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { allowedLoopbackHost } from '@ulpin/server/infrastructure/loopback-host';

type ContextRequest = Request & { apiRequestId?: string };

export function requestId(request: Request): string {
  return (request as ContextRequest).apiRequestId ?? randomUUID();
}

export function apiPort(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.API_PORT ?? '3188';
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error('API_PORT must be a TCP port from 1 to 65535.');
  }
  return Number(value);
}

function localOrigin(value: string): string {
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):[1-9]\d{0,4}$/i.test(value)) {
    throw new Error('API_ALLOWED_ORIGINS must contain only explicit loopback http origins.');
  }
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !allowedLoopbackHost(parsed.host, parsed.port || '80')
    || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password
    || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?$/i.test(parsed.host)) {
    throw new Error('API_ALLOWED_ORIGINS must contain only explicit loopback http origins.');
  }
  return parsed.origin;
}

/** Empty by default; a browser proxy may add specific local UI origins. */
export function apiAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.API_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw.split(',').map(value => localOrigin(value.trim()));
}

/** Uses the socket request, never forwarded host/proto headers. */
export function assertLocalHttpRequest(request: Request, port: number, allowedOrigins = apiAllowedOrigins()): void {
  const host = request.headers.host ?? null;
  if (!allowedLoopbackHost(host, String(port))) {
    throw new AppError(403, 'HOST_DENIED', 'Forbidden host.');
  }
  const origin = request.headers.origin;
  if (origin) {
    let valid = false;
    try {
      const parsed = new URL(origin);
      valid = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):[1-9]\d{0,4}$/i.test(origin)
        && parsed.protocol === 'http:' && (parsed.host.toLowerCase() === host?.toLowerCase()
        || allowedOrigins.includes(parsed.origin))
        && parsed.pathname === '/' && !parsed.search && !parsed.hash
        && !parsed.username && !parsed.password
        && allowedLoopbackHost(parsed.host, parsed.port || '80');
    } catch { /* Malformed and opaque origins are denied. */ }
    if (!valid) {
      throw new AppError(403, 'ORIGIN_DENIED', 'The request did not originate from the local workbench.');
    }
  }
}

export function guardLocalRequest(request: Request, response: Response, next: () => void, port: number, allowedOrigins: string[]): void {
  const id = randomUUID();
  (request as ContextRequest).apiRequestId = id;
  response.setHeader('X-Request-Id', id);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    assertLocalHttpRequest(request, port, allowedOrigins);
    next();
  } catch (error) {
    const denied = error instanceof AppError ? error : new AppError(403, 'HOST_DENIED', 'Forbidden host.');
    response.status(denied.status).json({ error: { code: denied.code, message: denied.message, requestId: id } });
  }
}
