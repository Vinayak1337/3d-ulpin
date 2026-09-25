const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Authority syntax is checked before URL normalization (which accepts alternate IP spellings). */
export function allowedLoopbackHost(authority: string | null, ports = process.env.ULPIN_LOOPBACK_PORTS ?? process.env.PORT ?? '3000'): boolean {
  if (!authority || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?$/i.test(authority)) return false;
  const configured = ports.split(',');
  if (!configured.length || configured.some(port => !/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) return false;
  try {
    const url = new URL(`http://${authority}`);
    return hosts.has(url.hostname) && configured.includes(url.port || '80');
  } catch { return false; }
}
