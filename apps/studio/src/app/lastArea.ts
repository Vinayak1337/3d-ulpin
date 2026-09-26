const KEY = 'ulpin.studio.lastArea';

/** Per-viewer convenience only; the URL stays the source of truth for selection. */
export function readLastArea(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeLastArea(areaId: string): void {
  try {
    window.localStorage.setItem(KEY, areaId);
  } catch {
    /* storage unavailable: nothing to remember */
  }
}
