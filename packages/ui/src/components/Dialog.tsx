import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal dialog (760 px `md`, 960 px `lg`). Escape and the backdrop close it; focus moves in and
 * returns to the opener. Clicks behind it never reach the map.
 */
export function Dialog({ title, size = 'lg', onClose, children, footer, aside }: {
  title: string; size?: 'md' | 'lg'; onClose: () => void; children: ReactNode; footer?: ReactNode; aside?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? ref.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab' && ref.current) trapFocus(event, ref.current);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="ul-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`ul-dialog ul-dialog--${size}`}>
        <header className="ul-dialog__head">
          <h2 id={titleId} className="ul-heading">{title}</h2>
          {aside}
        </header>
        <div className="ul-dialog__body">{children}</div>
        {footer ? <footer className="ul-dialog__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

function trapFocus(event: KeyboardEvent, root: HTMLElement) {
  const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
