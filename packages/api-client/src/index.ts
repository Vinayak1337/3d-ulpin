import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Schemas = components['schemas'];

/** Response body type for a GET path, straight from the OpenAPI document. */
export type GetResponse<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer T } } } };
}
  ? T
  : never;

/** Header the local data layer sets on every response it answers. */
export const LOCAL_SOURCE_HEADER = 'x-ulpin-local-source';

export interface ResponseOrigin {
  path: string;
  /** `live` when the Nest API answered, otherwise the local source label. */
  origin: 'live' | 'local';
  localSource: string | null;
}

type OriginListener = (event: ResponseOrigin) => void;
const listeners = new Set<OriginListener>();

/** Screens use this to show the "Local data" badge whenever a local route answered. */
export function onResponseOrigin(listener: OriginListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const originMiddleware: Middleware = {
  onResponse({ request, response }) {
    const localSource = response.headers.get(LOCAL_SOURCE_HEADER);
    const event: ResponseOrigin = {
      path: new URL(request.url).pathname,
      origin: localSource ? 'local' : 'live',
      localSource,
    };
    listeners.forEach((listener) => listener(event));
    return response;
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(ApiError.describe(status, body));
    this.name = 'ApiError';
  }

  /** Nest validation errors carry a top-level `message`; the API's own failures are `{ error: { code, message } }`. */
  private static describe(status: number, body: unknown): string {
    const wrapped = (body as { error?: unknown } | null)?.error;
    return ApiError.messageOf(body) ?? ApiError.messageOf(wrapped) ?? `The server answered ${status}.`;
  }

  private static messageOf(body: unknown): string | null {
    if (!body || typeof body !== 'object' || !('message' in body)) return null;
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
    return Array.isArray(message) ? message.join('; ') : null;
  }
}

/** One typed client for the Nest API. The base URL is same-origin; Vite proxies `/api`. */
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? 'http://localhost',
  // Resolve fetch at call time so a development interceptor installed after start-up still applies.
  fetch: (request) => globalThis.fetch(request),
});
api.use(originMiddleware);

/** Unwraps an openapi-fetch result, throwing ApiError so TanStack Query sees failures. */
export function unwrap<T>(
  result: { data?: T; error?: unknown; response: Response },
): T {
  if (result.response.ok && result.data !== undefined) return result.data;
  throw new ApiError(result.response.status, new URL(result.response.url || 'http://x/').pathname, result.error);
}
