import { useEffect, useRef } from 'react';

/**
 * Moves focus to the first field of a dialog body once the form is shown, also when it arrives after the dialog.
 * The component that renders the Dialog calls it, so it runs after the Dialog has noted the action that opened
 * it: a field with `autoFocus` takes focus before that, and the dialog then returns focus to nothing.
 */
export function useFieldFocus(shown: boolean) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown) body.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, [shown]);
  return body;
}
