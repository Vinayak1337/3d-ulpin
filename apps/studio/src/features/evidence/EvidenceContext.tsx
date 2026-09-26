import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { EvidenceRef } from './refs';
import { EvidenceViewer } from './EvidenceViewer';

type Open = (ref: EvidenceRef) => void;
const Context = createContext<Open>(() => {});

/** S7: any EvidenceChip opens the viewer through this; `snapshot` supplies the scene still. */
export function EvidenceProvider({ children, snapshot }: { children: ReactNode; snapshot?: () => string | null }) {
  const [open, setOpen] = useState<{ ref: EvidenceRef; still: string | null } | null>(null);
  const openRef = useCallback<Open>((ref) => setOpen({ ref, still: snapshot?.() ?? null }), [snapshot]);
  return (
    <Context.Provider value={openRef}>
      {children}
      {open ? <EvidenceViewer evidence={open.ref} still={open.still} onClose={() => setOpen(null)} /> : null}
    </Context.Provider>
  );
}

export const useOpenEvidence = () => useContext(Context);
