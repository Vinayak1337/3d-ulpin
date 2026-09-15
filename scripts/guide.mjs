import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, extname } from 'node:path';

// Resolve from this file so spaces in paths and different working directories work.
const root = fileURLToPath(new URL('../docs/tutorial-images/', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: pnpm guide [--port 3011]\nOr: node scripts/guide.mjs [--port 3011]');
  process.exit(0);
}
if (args.length && (args.length !== 2 || args[0] !== '--port')) {
  console.error('Usage: pnpm guide [--port 3011]');
  process.exit(1);
}
const port = Number(args[1] ?? 3011);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port must be an integer from 1 to 65535.');
  process.exit(1);
}
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const within = relative(root, path);
    if (within.startsWith('..') || isAbsolute(within) || pathname.includes('\\')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Open http://127.0.0.1:${port}/ if the guide is running, or use pnpm guide --port ${port === 65535 ? 3012 : port + 1}.`
    : `Cannot start guide: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Visual guide: http://127.0.0.1:${port}/\nPress Ctrl+C to stop. No database or Python required.`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
