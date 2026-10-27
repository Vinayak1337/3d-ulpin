import { useRef, useState } from 'react';
import { approveLayout, authorLayout } from './batch-queries';
import { createLayoutCommand, type LayoutCommandState } from './layout-command';
import { approveStreamedLayout, authorStreamedLayout } from './streamed-queries';
import { isStreamedBody, isStreamedPlan } from './streamed-question-model';

export function useLayoutCommand(caseId: string, sourceId: string, refresh: () => void) {
  const [state, setState] = useState<LayoutCommandState>({ busy: false, uncertain: false, phase: 'author',
    receipt: null, authored: false, error: '', concern: '', changed: false });
  const current = useRef(refresh);
  current.current = refresh;
  const command = useRef<ReturnType<typeof createLayoutCommand> | null>(null);
  // A large file's layout is authored and approved on its streamed profile; every other file's as before.
  command.current ??= createLayoutCommand({ author: body => isStreamedBody(body)
    ? authorStreamedLayout(caseId, sourceId, body) : authorLayout(caseId, sourceId, body),
  approve: (receipt, body) => isStreamedPlan(receipt.plan)
    ? approveStreamedLayout(caseId, sourceId, receipt.plan, receipt.id, body)
    : approveLayout(caseId, receipt, body) }, setState, () => current.current());
  return { ...command.current, state };
}
