import { useEffect, type ReactNode } from 'react';

/** Bottom-centre confirmation; dismisses itself after `ms`. */
export function Toast({ children, onDone, ms = 6000 }: { children: ReactNode; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(timer);
  }, [onDone, ms]);
  return <div className="ul-toast" role="status">{children}</div>;
}
