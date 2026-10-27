import HashWorker from './file-hash.worker.ts?worker&inline';

export function hashFile(file: Blob, partBytes: number, progress: (bytes: number) => void): Promise<string> {
  // The script is in the Studio bundle: checking a file cannot queue behind same-origin requests.
  const worker = new HashWorker();
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
