import { useSyncExternalStore } from 'react';
import { onResponseOrigin } from '@ulpin/api-client';

/** Local sources that answered at least one request in this session (for the Local data badge). */
const sources = new Set<string>();
let snapshot: string[] = [];
const subscribers = new Set<() => void>();

onResponseOrigin((event) => {
  if (event.origin !== 'local' || !event.localSource || sources.has(event.localSource)) return;
  sources.add(event.localSource);
  snapshot = [...sources];
  subscribers.forEach((notify) => notify());
});

export function useLocalSources(): string[] {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => snapshot,
  );
}
