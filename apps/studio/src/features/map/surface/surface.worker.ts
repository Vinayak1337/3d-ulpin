import { decodePart, replyTransfer, type DecodeRequest } from './decode';

/** Decodes surface parts off the main thread, one message per part, answered under its id. */
self.onmessage = (event: MessageEvent<{ id: number; request: DecodeRequest }>) => {
  const { id, request } = event.data;
  decodePart(request).then(
    (reply) => self.postMessage({ id, reply }, { transfer: replyTransfer(reply) }),
    (error: unknown) => self.postMessage({
      id, error: error instanceof Error ? error.message : 'It could not be decoded.',
    }),
  );
};
