import type { Response } from 'express';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { INGESTION_EVENT_LIMITS as limits } from '@ulpin/server/modules/usp/ingestion/events';

/** Await drain before producing another frame; at most one bounded frame is buffered. */
export async function writeIngestionFrame(response: Response, frame: string, signal: AbortSignal, assertAccess: () => void) {
  assertAccess(); signal.throwIfAborted();
  const bytes=Buffer.byteLength(frame);
  if (bytes > limits.frameBytes) throw new AppError(503,'INGESTION_FRAME_LIMIT','The notification exceeded its bounded frame size.');
  const deadline=Date.now()+limits.writeMs;
  // A burst of replay frames can fill the application buffer while write() still
  // reports true. Wait for the socket to flush before producing another frame.
  while(response.writableLength+bytes>limits.bufferBytes){
    assertAccess();signal.throwIfAborted();
    if(response.destroyed||response.writableEnded)throw new Error('Event reader disconnected.');
    if(Date.now()>=deadline)throw new AppError(503,'INGESTION_BUFFER_LIMIT','The bounded event response buffer is occupied.');
    await new Promise(resolve=>setTimeout(resolve,Math.min(10,deadline-Date.now())));
  }
  if (response.destroyed || response.writableEnded) throw new Error('Event reader disconnected.');
  if (response.write(frame)) return;
  await new Promise<void>((resolve,reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); signal.removeEventListener('abort',abort);
      response.removeListener('drain',drain); response.removeListener('close',close); response.removeListener('error',fail);
      if (error) reject(error); else resolve();
    };
    const drain = () => finish(), close = () => finish(new Error('Event reader disconnected.')),
      fail = (error: Error) => finish(error), abort = () => finish(new Error('Event reader disconnected.'));
    const timer = setTimeout(() => finish(new Error('Event reader backpressure deadline exceeded.')),limits.writeMs);
    response.once('drain',drain); response.once('close',close); response.once('error',fail);
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted || response.destroyed) abort();
  });
}
export async function waitIngestionPoll(signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort',abort); reject(new Error('Event reader disconnected.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },limits.pollMs);
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
  });
}
