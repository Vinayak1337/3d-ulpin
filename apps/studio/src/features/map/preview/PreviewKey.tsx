import type { PreviewLine } from './useReadPreview';
import styles from './PreviewKey.module.css';

/** The preview's dashed edge and each file's words, in the route's own terms; nothing here is a record. */
export function PreviewKey({ lines, className }: { lines: PreviewLine[]; className?: string }) {
  if (!lines.length) return null;
  return (
    <details className={className} open>
      <summary>Read so far</summary>
      <div className={styles.key}>
        <p className={styles.item}><span className={styles.edge} aria-hidden="true" />Outlines read so far</p>
        {lines.map((line) => (
          <p key={line.itemId} className={styles.words} role="status">
            <strong>{line.label}</strong> {line.line}
          </p>
        ))}
      </div>
    </details>
  );
}
