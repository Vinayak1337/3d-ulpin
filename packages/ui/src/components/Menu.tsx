import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  /** Planned items are listed, disabled, with a Planned badge rather than hidden. */
  planned?: boolean;
  disabled?: boolean;
}

export function Menu({ label, icon, items, align = 'right' }: { label: ReactNode; icon?: PhosphorIcon; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="ul-menu" ref={root}>
      <button type="button" className="ul-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {icon ? <Icon icon={icon} /> : null}
        {label}
      </button>
      {open ? (
        <div role="menu" className={`ul-menu__list ul-menu__list--${align}`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled || item.planned}
              onClick={() => { setOpen(false); item.onSelect?.(); }}
            >
              <span className="ul-grow">{item.label}</span>
              {item.planned ? <span className="ul-badge">Planned</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
