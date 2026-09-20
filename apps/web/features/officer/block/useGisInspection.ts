"use client";
import { useEffect, useRef, useState } from "react";
import type { GisInspection } from "@ulpin/contracts";

export function useGisInspection() {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<GisInspection | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  function clear() {
    controller.current?.abort();
    controller.current = null;
    setFile(null);
    setMetadata(null);
    setReading(false);
    setError("");
  }
  async function inspect(next: File, layer?: string) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    if (next !== file) setMetadata(null);
    setFile(next);
    setError("");
    setReading(true);
    try {
      if (!next.size || next.size > 16 * 1024 * 1024)
        throw new Error("Choose a nonempty GIS file up to 16 MiB.");
      const body = new FormData();
      body.set("file", next);
      if (layer) body.set("layer", layer);
      const response = await fetch("/api/v1/import-packages/inspect", {
        method: "POST",
        body,
        signal: current.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ||
            "Could not read this GIS file. Retry or choose another source.",
        );
      if (controller.current !== current) return null;
      setMetadata(result);
      return result as GisInspection;
    } catch (cause) {
      if (controller.current === current)
        setError(
          cause instanceof Error ? cause.message : "File inspection failed.",
        );
      return null;
    } finally {
      if (controller.current === current) setReading(false);
    }
  }
  return { file, metadata, reading, error, inspect, clear };
}
