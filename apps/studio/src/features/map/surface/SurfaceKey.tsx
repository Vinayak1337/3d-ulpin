import { Toggle } from '@ulpin/ui';
import type { SurfaceLine } from './parts';

/** Each read surface's line where the map has no layer list: what is drawn, what is not and why; display only. */
export function SurfaceKey({ lines, onShow, className }: {
  lines: (SurfaceLine & { checked: boolean })[];
  onShow: (itemId: string, on: boolean) => void;
  className?: string;
}) {
  if (!lines.length) return null;
  return (
    <details className={className} open>
      <summary>Read surfaces</summary>
      {lines.map((line) => (
        <Toggle key={line.itemId} label={line.label} hint={line.line} checked={line.checked}
          onChange={(on) => onShow(line.itemId, on)} />
      ))}
    </details>
  );
}
