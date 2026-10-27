import type { PreviewPart } from './preview-model';

/** The preview fits inside this many canvas pixels, keeping the file's own proportions. */
export const PREVIEW_BOX = Object.freeze({ width: 640, height: 400 });
/** Each point is drawn as a square of this many canvas pixels. */
const DOT = 2;

type XY = readonly [number, number];

/** Source coordinates to canvas pixels: one scale on both axes, so nothing is stretched. */
export interface PreviewFrame {
  width: number;
  height: number;
  at(xy: XY): [number, number];
}

/**
 * The frame of the parts' own corners. The first part's first corner (a window's upper left, a batch's north-west)
 * is drawn at the top, so a picture's rows run down the canvas as written; no axis is assumed from a CRS.
 */
export function previewFrame(parts: readonly PreviewPart[]): PreviewFrame | null {
  if (!parts.length) return null;
  const corners = parts.flatMap((part) => part.corners);
  const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const scale = Math.min(PREVIEW_BOX.width / spanX, PREVIEW_BOX.height / spanY);
  const [first, , , last] = parts[0]!.corners;
  const downward = last[1] < first[1];
  return {
    width: Math.max(1, Math.round(spanX * scale)),
    height: Math.max(1, Math.round(spanY * scale)),
    at: ([x, y]) => [(x - minX) * scale, (downward ? maxY - y : y - minY) * scale],
  };
}

/** Each point batch as squares in one pixel buffer, coloured as the decoder ranked them. */
function drawPoints(context: CanvasRenderingContext2D, frame: PreviewFrame, parts: readonly PreviewPart[]): void {
  const image = context.createImageData(frame.width, frame.height);
  for (const { points } of parts) {
    if (!points) continue;
    for (let n = 0; n < points.positions.length / 3; n++) {
      const [px, py] = frame.at([points.positions[n * 3]!, points.positions[n * 3 + 1]!]);
      const left = Math.min(frame.width - DOT, Math.max(0, Math.round(px - DOT / 2)));
      const top = Math.min(frame.height - DOT, Math.max(0, Math.round(py - DOT / 2)));
      for (let row = top; row < top + DOT; row++) {
        for (let column = left; column < left + DOT; column++) {
          const at = (row * frame.width + column) * 4;
          for (let c = 0; c < 3; c++) image.data[at + c] = Math.round(points.colors[n * 3 + c]! * 255);
          image.data[at + 3] = 255;
        }
      }
    }
  }
  context.putImageData(image, 0, 0);
}

/** A picture laid between its corners: its upper left, upper right and lower left fix the affine. */
function drawPicture(context: CanvasRenderingContext2D, frame: PreviewFrame, part: PreviewPart): void {
  const image = part.image!;
  const [upperLeft, upperRight, , lowerLeft] = part.corners.map(frame.at);
  context.setTransform(
    (upperRight![0] - upperLeft![0]) / image.width, (upperRight![1] - upperLeft![1]) / image.width,
    (lowerLeft![0] - upperLeft![0]) / image.height, (lowerLeft![1] - upperLeft![1]) / image.height,
    upperLeft![0], upperLeft![1],
  );
  context.drawImage(image, 0, 0);
}

/** The parts as one mosaic in the file's own frame: points first, then each picture at its corners. */
export function drawPreview(context: CanvasRenderingContext2D, frame: PreviewFrame,
  parts: readonly PreviewPart[]): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, frame.width, frame.height);
  if (parts.some((part) => part.points)) drawPoints(context, frame, parts);
  context.imageSmoothingEnabled = false;
  for (const part of parts) if (part.image) drawPicture(context, frame, part);
  context.setTransform(1, 0, 0, 1, 0, 0);
}
