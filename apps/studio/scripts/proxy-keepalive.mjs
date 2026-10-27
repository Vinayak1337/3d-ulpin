// Loopback transport regression: node apps/studio/scripts/proxy-keepalive.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile, preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const requests = 48;
let connections = 0;
let stream;
const api = createServer(async (req, res) => {
  assert.equal(req.headers.origin, process.env.ULPIN_API_TARGET);
  assert.equal(req.headers.host, new URL(process.env.ULPIN_API_TARGET).host);
  if (req.url === '/api/events') {
    stream = res;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: first\n\n');
    return;
  }
  let bytes = 0;
  for await (const chunk of req) bytes += chunk.length;
  setTimeout(() => res.end(String(bytes)), 10);
});
api.on('connection', () => connections++);
api.listen(0, '127.0.0.1');
await once(api, 'listening');
process.env.ULPIN_API_TARGET = `http://127.0.0.1:${api.address().port}`;
const deadline = setTimeout(() => { throw new Error('Loopback proxy test exceeded 30 seconds'); }, 30_000);

async function streamAndUpload(origin, get) {
  const events = await fetch(`${origin}/api/events`, { signal: AbortSignal.timeout(10_000) });
  const reader = events.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  await Promise.all(Array.from({ length: requests }, get));
  const body = Buffer.alloc(1024 * 1024, 7);
  const upload = await fetch(`${origin}/api/upload`, { method: 'POST', body,
    signal: AbortSignal.timeout(10_000) });
  assert.equal(upload.status, 200);
  assert.equal(await upload.text(), String(body.length));
  assert.equal(stream.writableEnded, false);
  stream.end('data: last\n\n');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: last\n\n');
  assert.equal((await reader.read()).done, true);
}

async function exercise(config, pooled) {
  const options = { ...config.preview.proxy['/api'] };
  const agent = options.agent;
  assert.equal(config.server.proxy['/api'].agent, agent);
  assert.equal(agent.keepAlive, true);
  assert.equal(agent.maxSockets, 16);
  if (!pooled) delete options.agent; // The previous config: http-proxy defaults to agent=false.
  const instance = await preview({ ...config, root, configFile: false, envDir: false,
    preview: { ...config.preview, port: 0, strictPort: true, proxy: { '/api': options } } });
  const origin = `http://127.0.0.1:${instance.httpServer.address().port}`;
  const start = connections;
  const get = async () => {
    const response = await fetch(`${origin}/api/count`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '0');
  };
  try {
    await Promise.all(Array.from({ length: requests }, get));
    const opened = connections - start;
    if (pooled) assert.ok(opened <= agent.maxSockets, `${opened} upstream connections`);
    else assert.equal(opened, requests);
    if (pooled) {
      await streamAndUpload(origin, get);
      assert.ok(connections - start <= agent.maxSockets);
    }
    console.log(JSON.stringify({ pooled, requests, opened, totalOpened: connections - start,
      maxSockets: pooled ? agent.maxSockets : null, eventStreamAndUpload: pooled ? 'passed' : 'not run' }));
  } finally {
    stream?.end();
    instance.httpServer.closeAllConnections();
    await new Promise(resolve => instance.httpServer.close(resolve));
  }
}

let config;
try {
  ({ config } = await loadConfigFromFile({ command: 'serve', mode: 'test' }, `${root}/vite.config.ts`, root));
  await exercise(config, false);
  await exercise(config, true);
} finally {
  clearTimeout(deadline);
  config?.preview.proxy['/api'].agent.destroy();
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
}
