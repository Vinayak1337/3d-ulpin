import { useRef, useState } from 'react';
import { approveLayout, authorLayout } from './batch-queries';
import { createLayoutCommand, type LayoutCommandState } from './layout-command';

export function useLayoutCommand(caseId: string, sourceId: string, refresh: () => void) {
  const [state, setState] = useState<LayoutCommandState>({ busy: false, uncertain: false, phase: 'author',
    receipt: null, authored: false, error: '', concern: '', changed: false });
  const current = useRef(refresh);
  current.current = refresh;
  const command = useRef<ReturnType<typeof createLayoutCommand> | null>(null);
  command.current ??= createLayoutCommand({ author: body => authorLayout(caseId, sourceId, body),
    approve: (receipt, body) => approveLayout(caseId, receipt, body) }, setState, () => current.current());
  return { ...command.current, state };
}
