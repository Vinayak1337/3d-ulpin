"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
export { registryRequest as request } from "@/lib/registry-client";

/** A response may only populate the route that requested it. Refresh retains the current snapshot. */
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    loading: boolean;
    error: string;
  }>({ path, data: null, loading: !!path, error: "" });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const latestPath = useRef(path);
  latestPath.current = path;
  const reload = useCallback(async () => {
    if (!mounted.current || latestPath.current !== path) return;
    controller.current?.abort();
    if (!path) {
      setState({ path, data: null, loading: false, error: "" });
      return;
    }
    const pending = new AbortController();
    controller.current = pending;
    setState((old) => ({
      path,
      data: old.path === path ? old.data : null,
      loading: true,
      error: "",
    }));
    try {
      const response = await fetch(`/api/v1${path}`, {
        cache: "no-store",
        signal: pending.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ||
            body.detail ||
            `Request failed (${response.status})`,
        );
      if (!pending.signal.aborted && latestPath.current === path)
        setState({ path, data: body, loading: false, error: "" });
    } catch (cause) {
      if (!pending.signal.aborted && latestPath.current === path)
        setState((old) => ({
          ...old,
          loading: false,
          error:
            cause instanceof Error
              ? cause.message
              : "Unable to load this record.",
        }));
    }
  }, [path]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [reload]);
  const setData = useCallback(
    (data: T | null) => {
      if (!mounted.current || latestPath.current !== path) return;
      // A mutation response is newer than any already-running snapshot request.
      controller.current?.abort();
      controller.current = null;
      setState({ path, data, loading: false, error: "" });
    },
    [path],
  );
  return {
    data: state.path === path ? state.data : null,
    loading: state.path !== path ? !!path : state.loading,
    error: state.path === path ? state.error : "",
    reload,
    setData,
  };
}
export function useMutation() {
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
      return await operation();
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
