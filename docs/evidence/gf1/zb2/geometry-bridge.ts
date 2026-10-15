import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// The product Python boundary; no geometry, profile or record is scaffolded by this bridge.
export async function geometryBridge() {
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const value of request) chunks.push(Buffer.from(value));
      const operation = request.url!.split('/').at(-1);
      assert(['normalize', 'check', 'inspect-gis'].includes(operation!));
      const module = operation === 'inspect-gis' ? 'geo.gis_inspection' : 'geo.area';
      let method = 'check_area';
      if (operation === 'normalize') method = 'normalize_area';
      if (operation === 'inspect-gis') method = 'inspect_gis';
      const code = 'import sys,json;sys.path.insert(0,"services/geo");'
        + `from ${module} import ${method};print(json.dumps(${method}(json.load(sys.stdin))))`;
      const run = spawnSync('E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe', ['-B', '-c', code],
        { input: Buffer.concat(chunks), encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 ** 2 });
      assert.equal(run.status, 0, run.stderr);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(run.stdout);
    } catch (error: any) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: error.message }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.GEO_URL = `http://127.0.0.1:${address.port}`;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  return server;
}
