"use client";
import { useEffect, useState } from "react";
import type { BuildingDossier } from "@ulpin/contracts";

/** Bounded directory summaries; source evidence stays on its owning server record. */
export function useRegisterDirectory(ids: string[]) {
  const key = [...new Set(ids)].slice(0, 12).join(",");
  const [state, setState] = useState<{
    key: string;
    data: BuildingDossier[];
    loading: boolean;
    failed: number;
  }>({ key, data: [], loading: false, failed: 0 });
  useEffect(() => {
    const controller = new AbortController();
    const values = key ? key.split(",") : [];
    setState({ key, data: [], loading: !!values.length, failed: 0 });
    void Promise.allSettled(
      values.map(async (id) => {
        const response = await fetch(
          `/api/v1/buildings/${encodeURIComponent(id)}/dossier`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Property unavailable");
        return response.json() as Promise<BuildingDossier>;
      }),
    ).then((results) => {
      if (!controller.signal.aborted)
        setState({
          key,
          data: results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
          loading: false,
          failed: results.filter((result) => result.status === "rejected")
            .length,
        });
    });
    return () => controller.abort();
  }, [key]);
  return state.key === key
    ? state
    : { key, data: [], loading: true, failed: 0 };
}
