import { hashSlices } from './file-hash';

self.onmessage = async (event: MessageEvent<{ file: Blob; partBytes: number }>) => {
  try {
    const sha256 = await hashSlices(event.data.file, event.data.partBytes,
      bytes => self.postMessage({ bytes }));
    self.postMessage({ sha256 });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The file could not be read.' });
  }
};
