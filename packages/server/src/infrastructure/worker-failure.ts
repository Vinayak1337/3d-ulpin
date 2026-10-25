import { AppError } from './errors';

/** Diagnostics only. Unknown free text is withheld rather than risking source data, SQL or credentials. */
export function safeWorkerCause(error: unknown) {
  if (error instanceof AppError) return null;
  const item = error instanceof Error ? error as Error & {
    code?: unknown; errno?: unknown; syscall?: unknown;
  } : null;
  const name = item?.constructor.name;
  const safeMessages = [
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
    'Connection terminated',
  ];
  const code = typeof item?.code === 'string' && /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{1,31})$/.test(item.code)
    ? item.code : undefined;
  const rawErrno = item?.errno;
  let errno: string | number | undefined;
  if (typeof rawErrno === 'number' && Number.isSafeInteger(rawErrno)) errno = rawErrno;
  else if (typeof rawErrno === 'string' && /^E[A-Z0-9_]{1,31}$/.test(rawErrno)) errno = rawErrno;
  const syscall = typeof item?.syscall === 'string'
    && /^(connect|read|write|open|stat|scandir|spawn|unlink|rename|mkdir|rmdir|listen|getaddrinfo)$/.test(item.syscall)
    ? item.syscall : undefined;
  return {
    class: typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) ? name : 'Unknown',
    ...(code ? { code } : {}), ...(errno === undefined ? {} : { errno }), ...(syscall ? { syscall } : {}),
    message: item && safeMessages.includes(item.message) ? item.message.slice(0, 200) : 'Error detail withheld.',
  };
}
