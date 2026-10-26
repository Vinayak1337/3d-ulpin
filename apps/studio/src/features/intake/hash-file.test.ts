import { resolveObjectURL } from 'node:buffer';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker as Thread } from 'node:worker_threads';
import { build } from 'vite';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { hashFile as HashFile } from './hash-file';

let hashFile: typeof HashFile;
const threads: Thread[] = [];
const urls: string[] = [];
const terminated = vi.fn();

// Run the actual bundled script, adapting only the browser messaging boundary to a local thread.
class LocalWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  ready: Promise<Thread>;

  constructor(url: string | URL) {
    urls.push(String(url));
    if (!String(url).startsWith('blob:')) throw new Error('A hash worker must not fetch its script.');
    const blob = resolveObjectURL(String(url));
    if (!blob) throw new Error('The inline worker script is missing.');
    this.ready = blob.text().then(code => {
      const thread = new Thread(`
        const { parentPort, workerData } = require('node:worker_threads');
        globalThis.self = globalThis;
        self.location = { href: 'blob:hash-test' };
        self.postMessage = data => parentPort.postMessage(data);
        self.fetch = self.importScripts = () => { throw new Error('Network access during hashing'); };
        import('data:text/javascript;base64,' + Buffer.from(workerData).toString('base64')).then(() => {
          parentPort.on('message', data => self.onmessage({ data }));
        });
      `, { eval: true, workerData: code });
      threads.push(thread);
      thread.on('message', data => this.onmessage?.({ data }));
      thread.on('error', error => this.onerror?.({ message: error.message }));
      return thread;
    });
  }

  addEventListener(_kind: string, listener: () => void) {
    void this.ready.then(thread => thread.on('error', listener));
  }
  postMessage(data: unknown) { void this.ready.then(thread => thread.postMessage(data)); }
  terminate() {
    terminated();
    void this.ready.then(thread => thread.terminate());
  }
}

beforeAll(async () => {
  const bundled = await build({ configFile: false, envDir: false, logLevel: 'silent', build: {
    write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('./hash-file.ts', import.meta.url)), formats: ['es'] },
  } });
  const outputs = (Array.isArray(bundled) ? bundled : [bundled])
    .flatMap(result => 'output' in result ? result.output : []);
  const entry = outputs.find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('The hash entry was not built.');
  expect(outputs.filter(output => output.fileName !== entry.fileName)).toEqual([]);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`;
  vi.stubGlobal('self', globalThis);
  hashFile = (await import(/* @vite-ignore */ moduleUrl)).hashFile;
});

afterEach(async () => {
  await Promise.all(threads.splice(0).map(thread => thread.terminate()));
  urls.length = 0;
  terminated.mockClear();
  vi.unstubAllGlobals();
});

it.each([[3, 8], [2 * 1024 * 1024 + 17, 1024 * 1024]])(
  'hashFile checks a %i-byte Blob in %i-byte parts with no script request', async (size, partBytes) => {
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('Worker', LocalWorker);
    const fetch = vi.fn(() => { throw new Error('Network access during hashing'); });
    vi.stubGlobal('fetch', fetch);
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
    const progress: number[] = [];
    expect(await hashFile(new Blob([bytes]), partBytes, count => progress.push(count)))
      .toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(progress).toEqual(Array.from({ length: Math.ceil(size / partBytes) },
      (_, index) => Math.min((index + 1) * partBytes, size)));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^blob:/);
    expect(fetch).not.toHaveBeenCalled();
    expect(terminated).toHaveBeenCalledOnce();
  },
);
