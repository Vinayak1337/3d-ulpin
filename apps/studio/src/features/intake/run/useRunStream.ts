import { useBatchStream } from '../useBatchStream';
import { shouldRefetch, type Target } from './model';

/** Recording progress is another consumer of the page's one case subscription, not another event reader. */
export function useRunStream(caseId: string, progress: readonly Target[], refresh: () => void) {
  return useBatchStream(caseId, shouldRefetch(progress, 0, 5000), refresh);
}
