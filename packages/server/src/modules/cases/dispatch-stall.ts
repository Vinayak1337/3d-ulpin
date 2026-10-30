import { performance } from 'node:perf_hooks';

/** The operation of every job this process holds, and nothing else. */
export type HeldOperations = () => readonly string[];
export type StallLogOptions = {
  now?: () => number;
  warn?: (line: string) => void;
};

const TURN_MS = 100;
const STALL_MS = 250;
const LINE_GAP_MS = 1000;

/** Counts the operations present in both lists, as many times as the smaller list holds each one. */
function heldThroughout(before: readonly string[], after: readonly string[]): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const operation of before) remaining.set(operation, (remaining.get(operation) ?? 0) + 1);
  const counts = new Map<string, number>();
  for (const operation of after) {
    const left = remaining.get(operation) ?? 0;
    if (left === 0) continue;
    remaining.set(operation, left - 1);
    counts.set(operation, (counts.get(operation) ?? 0) + 1);
  }
  return counts;
}

/** Operation names only, most held first, then by name; `none` when nothing was held throughout. */
function holdingList(counts: Map<string, number>): string {
  const sorted = [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
  if (sorted.length === 0) return 'none';
  return sorted.map(([operation, count]) => `${operation} x${count}`).join(', ');
}

/**
 * Checks the event loop every 100 ms. A turn more than 250 ms late writes one line with its lateness and the
 * operations held both before and after the stall; never a job id, payload, file name, case id or error message. At
 * most one line a second: a stall inside that second is only counted, and the next line adds the count.
 */
export function startStallLog(held: HeldOperations, options: StallLogOptions = {}): () => void {
  const now = options.now ?? (() => performance.now());
  const warn = options.warn ?? ((line: string) => console.warn(line));
  let previous = now();
  let before = [...held()];
  let lastLine = -Infinity;
  let suppressed = 0;
  const timer = setInterval(() => {
    const current = now();
    const after = [...held()];
    const late = current - previous - TURN_MS;
    if (late > STALL_MS && current - lastLine < LINE_GAP_MS) {
      suppressed++;
    } else if (late > STALL_MS) {
      const holding = holdingList(heldThroughout(before, after));
      const more = suppressed > 0 ? ` (+${suppressed} more)` : '';
      warn(`Dispatcher event loop stalled ${Math.round(late)} ms; holding: ${holding}${more}`);
      lastLine = current;
      suppressed = 0;
    }
    previous = current;
    before = after;
  }, TURN_MS);
  timer.unref();
  return () => clearInterval(timer);
}
