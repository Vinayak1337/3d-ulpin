"use client";
import { useEffect } from "react";
export function useClearDrawing(clear: () => void, enabled: boolean) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !enabled ||
        event.defaultPrevented ||
        event.isComposing ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "q"
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      clear();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [clear, enabled]);
}
