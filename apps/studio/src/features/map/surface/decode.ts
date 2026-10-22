import { placeBatch, readLasRecords, type PlacedCorners } from './las';
import { partPicture, type PartPicture } from './pixels';
import { decodeTiff, SurfaceRefusal } from './tiff';

export type DecodeRequest = { kind: 'raster'; bytes: ArrayBuffer }
  | { kind: 'points'; bytes: ArrayBuffer; corners: PlacedCorners; recordLength?: number };
export type DecodeReply = { kind: 'raster'; picture: PartPicture }
  | ({ kind: 'points' } & ReturnType<typeof placeBatch>)
  | { refusal: string };

/** One part's artifact to canvas bytes or flat points; a refusal comes back as words. */
export async function decodePart(request: DecodeRequest): Promise<DecodeReply> {
  try {
    if (request.kind === 'raster') return { kind: 'raster', picture: partPicture(await decodeTiff(request.bytes)) };
    return { kind: 'points', ...placeBatch(readLasRecords(request.bytes, request.recordLength), request.corners) };
  } catch (error) {
    if (error instanceof SurfaceRefusal) return { refusal: error.message };
    throw error;
  }
}

/** The buffers a reply hands over to the main thread without copying. */
export function replyTransfer(reply: DecodeReply): ArrayBuffer[] {
  if ('refusal' in reply) return [];
  if (reply.kind === 'raster') return [reply.picture.rgba.buffer as ArrayBuffer];
  return [reply.positions.buffer as ArrayBuffer, reply.colors.buffer as ArrayBuffer];
}
