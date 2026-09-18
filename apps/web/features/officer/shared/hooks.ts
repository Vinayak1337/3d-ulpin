"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
export { registryRequest as request } from "@/lib/registry-client";

export { useSharedResource as useResource } from "@/features/spatial/data/useResource";
import { useSpatialServices } from "@/features/spatial/data/Provider";

export function useMutation() {
  const { resources } = useSpatialServices();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async <T>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      resources.invalidate();
      return result;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation could not be completed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { run, busy, error, clearError: () => setError("") };
}
export function useQueryState<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
) {
  const search = useSearchParams(),
    pathname = usePathname(),
    router = useRouter();
  const raw = search.get(key);
  const value = choices.includes(raw as T) ? (raw as T) : fallback;
  const setValue = (next: T) => {
    const query = new URLSearchParams(search.toString());
    if (next === fallback) query.delete(key);
    else query.set(key, next);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, {
      scroll: false,
    });
  };
  return [value, setValue] as const;
}
export function useDebouncedValue<T>(value: T, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
