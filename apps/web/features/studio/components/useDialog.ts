import { useEffect, useRef } from 'react';

/** Accessible modal focus management, with restoration to its invoking control. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    (focusable()[0] || root).focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { e.preventDefault(); root.focus(); return; }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && index <= 0) { e.preventDefault(); items.at(-1)!.focus(); }
      else if (!e.shiftKey && (index === -1 || index === items.length - 1)) { e.preventDefault(); items[0].focus(); }
    };
    const contain = (e: FocusEvent) => { if (e.target instanceof Node && !root.contains(e.target)) (focusable()[0] || root).focus({ preventScroll: true }); };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', contain);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', contain);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
