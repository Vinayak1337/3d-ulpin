import { useEffect, useState } from 'react';
import { chainState, type SpaceWorkflow } from '../../local/workflow';

export type LocalChain = 'consistent' | 'broken' | 'unknown';

/** What this browser's own recomputation of a draft's hash chain found. Never a statement by the server. */
export const LOCAL_CHAIN_WORDS: Record<LocalChain, string> = {
  consistent: 'Local chain consistent',
  broken: 'Local chain broken',
  unknown: 'Local chain not checked',
};
export const LOCAL_CHAIN_TONES: Record<LocalChain, 'success' | 'danger' | 'neutral'> = {
  consistent: 'success',
  broken: 'danger',
  unknown: 'neutral',
};

/** Recomputes the chain of a browser-made draft; `unknown` until that has finished. */
export function useLocalChain(workflow: SpaceWorkflow | null | undefined): LocalChain {
  const [chain, setChain] = useState<LocalChain>('unknown');
  useEffect(() => {
    if (workflow) void chainState(workflow).then(setChain);
  }, [workflow]);
  return chain;
}
