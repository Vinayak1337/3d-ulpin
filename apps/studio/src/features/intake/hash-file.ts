export function hashFile(file: Blob, partBytes: number, progress: (bytes: number) => void): Promise<string> {
  const worker = new Worker(new URL('./file-hash.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ bytes?: number; sha256?: string; error?: string }>) => {
      if (event.data.bytes !== undefined) progress(event.data.bytes);
      if (event.data.sha256) {
        worker.terminate();
        resolve(event.data.sha256);
      }
      if (event.data.error) {
        worker.terminate();
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message || 'The file could not be checked.'));
    };
    worker.postMessage({ file, partBytes });
  });
}
