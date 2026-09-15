"use client";
import { useCallback, useEffect, useState } from "react";
import type { Calibration, Measurement } from "./types";

type Draft = {
  calibrations: Record<string, Calibration>;
  measurements: Measurement[];
};
const empty = (): Draft => ({ calibrations: {}, measurements: [] });
export const calibrationKey = (sourceId: string, page: number) =>
  `${sourceId}:${page}`;
export function useMeasurements(workspaceId: string) {
  const key = `ulpin-app-workspace-notes:1:${workspaceId}`;
  const [draft, setDraft] = useState<Draft>(empty);
  const [loaded, setLoaded] = useState("");
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      setDraft(
        value && Array.isArray(value.measurements) && value.calibrations
          ? value
          : empty(),
      );
    } catch {
      setDraft(empty());
      setStorageError("Saved device notes could not be opened.");
    }
    setLoaded(key);
  }, [key]);
  useEffect(() => {
    if (loaded !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      setStorageError("");
    } catch {
      setStorageError("Device storage is full. Export notes before leaving.");
    }
  }, [draft, key, loaded]);
  const setCalibration = useCallback(
    (sourceId: string, page: number, calibration?: Calibration) =>
      setDraft((old) => {
        const next = { ...old.calibrations };
        if (calibration) next[calibrationKey(sourceId, page)] = calibration;
        else delete next[calibrationKey(sourceId, page)];
        return { ...old, calibrations: next };
      }),
    [],
  );
  const addMeasurement = useCallback(
    (measurement: Measurement) =>
      setDraft((old) => ({
        ...old,
        measurements: [...old.measurements, measurement],
      })),
    [],
  );
  const removeMeasurement = useCallback(
    (id: string) =>
      setDraft((old) => ({
        ...old,
        measurements: old.measurements.filter((m) => m.id !== id),
      })),
    [],
  );
  const noteMeasurement = useCallback(
    (id: string) =>
      setDraft((old) => ({
        ...old,
        measurements: old.measurements.map((m) =>
          m.id === id ? { ...m, noted: !m.noted } : m,
        ),
      })),
    [],
  );
  const exportNotes = useCallback(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            scope: "Local measurement notes; not registry geometry",
            workspaceId,
            ...draft,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workspace-measurement-notes.json";
    link.click();
    URL.revokeObjectURL(url);
  }, [draft, workspaceId]);
  return {
    ...draft,
    setCalibration,
    addMeasurement,
    removeMeasurement,
    noteMeasurement,
    exportNotes,
    storageError,
    loaded: loaded === key,
  };
}
