import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export interface PanelProps {
  /** Heading in `studio-heading` (17px/600). Omit for a headless panel. */
  title?: ReactNode;
  /** Right side of the head row: a Badge, caption or icon. */
  aside?: ReactNode;
  /** Replaces the default head row entirely (e.g. a multi-line identity header). */
  head?: ReactNode;
  /** Content placed directly under the head with no padding (Tabs, a Table). */
  flush?: ReactNode;
  /** Padded body. */
  children?: ReactNode;
  /** Footer row on `surface-subtle`: at most one primary and one secondary action. */
  footer?: ReactNode;
  /** Semantic element. */
  as?: 'div' | 'section' | 'aside' | 'article';
  /** Body padding override, e.g. 8 for list-like bodies. */
  bodyPadding?: number | string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The standard container: `surface` fill, 1px `border-strong`, `radius-12`, `shadow-card`, with head, body and footer rows.
 */
export function Panel({ title, aside, head, flush, children, footer, as = 'div', bodyPadding, className, style }: PanelProps) {
  const El = as;
  return (
    <El className={cx('ul-panel', className)} style={style}>
      {head ??
        (title !== undefined || aside !== undefined ? (
          <div className="ul-panel__head">
            {title !== undefined && <h3 className="ul-panel__title">{title}</h3>}
            {aside}
          </div>
        ) : null)}
      {flush}
      {children !== undefined && children !== null && (
        <div className="ul-panel__body" style={bodyPadding !== undefined ? { padding: bodyPadding } : undefined}>
          {children}
        </div>
      )}
      {footer && <div className="ul-panel__foot">{footer}</div>}
    </El>
  );
}
