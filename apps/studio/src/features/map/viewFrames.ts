import { useSyncExternalStore } from 'react';

/** Frame updates belong to projected labels/readouts, not the map's data and layer-list React tree. */
export function createViewFrames() {
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => revision,
    emit() {
      revision++;
      for (const listener of listeners) listener();
    },
  };
}

export type ViewFrames = ReturnType<typeof createViewFrames>;

export function useViewFrame(frames: ViewFrames): void {
  useSyncExternalStore(frames.subscribe, frames.snapshot, frames.snapshot);
}
