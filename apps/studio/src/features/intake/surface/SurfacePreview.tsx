import { useEffect, useMemo, useRef, useState } from 'react';
import { browserSurfaceIo, SurfaceDecoder } from '../../map/surface/api';
import type { IntakeItem } from '../batch-model';
import { drawPreview, previewFrame } from './preview-frame';
import { SurfacePreviewReader, type PreviewView } from './preview-model';
import styles from './SurfacePreview.module.css';

const NOTHING_READ: PreviewView = { parts: [], reasons: [], notes: [] };

/** The item's parts read for the preview, through the map's routes and decode worker, while the detail is open. */
function useSurfacePreview(item: IntakeItem): PreviewView {
  const [view, setView] = useState(NOTHING_READ);
  const [reader, setReader] = useState<SurfacePreviewReader | null>(null);
  useEffect(() => {
    const decoder = new SurfaceDecoder();
    const preview = new SurfacePreviewReader(browserSurfaceIo(decoder), setView);
    setReader(preview);
    return () => { preview.dispose(); decoder.dispose(); };
  }, []);
  useEffect(() => { reader?.sync(item); }, [reader, item]);
  return view;
}

/**
 * S5.12: a kept orthophoto, terrain raster or point cloud the map does not draw (no batch area, outside it, or no
 * stated CRS), drawn in the file's own frame: pictures by their source corners, points from above. It is shown only
 * once a display read says a part is not placed. Nothing is placed, converted or measured.
 */
export function SurfacePreview({ item }: { item: IntakeItem }) {
  const view = useSurfacePreview(item);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useMemo(() => previewFrame(view.parts), [view.parts]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context && frame) drawPreview(context, frame, view.parts);
  }, [frame, view.parts]);
  if (!view.reasons.length) return null;
  return <section className={styles.panel} aria-label={`Not on the map: ${item.name}`}>
    <h2 className="ul-heading">Own frame · display only · {item.name}</h2>
    <ul className={styles.reasons}>
      {view.reasons.map((reason) => <li key={reason}>Not placed: {reason}</li>)}
    </ul>
    {frame ? <canvas ref={canvas} className={styles.canvas} width={frame.width} height={frame.height} role="img"
      aria-label={`Read parts of ${item.name}`} /> : null}
    {view.notes.map((note) => <p key={note} className="ul-caption">{note}</p>)}
  </section>;
}
