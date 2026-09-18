"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useSpatialServices } from "./Provider";
const empty = Object.freeze({ data: null, loading: false, error: "", updatedAt: 0 });
async function fetchResource(path: string, signal: AbortSignal) {
    const response = await fetch(`/api/v1${path}`, { cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok)
        throw new Error(body.error?.message || body.detail || `Request failed (${response.status})`);
    return body;
}
export function useSharedResource<T>(path: string | null) {
    const { resources } = useSpatialServices();
    const subscribe = useCallback((notify: () => void) => path ? resources.subscribe(path, notify) : () => { }, [resources, path]);
    const read = useCallback(() => path ? resources.read<T>(path) : empty, [resources, path]);
    const state = useSyncExternalStore(subscribe, read, read);
    // A cached resource may outlive its page. Its old hook callbacks must not
    // restart requests or mutate records after that subscriber has left.
    const lifecycle = useMemo(() => ({ active: false }), [path, resources]);
    useEffect(() => {
        if (!path) return;
        lifecycle.active = true;
        const release = resources.acquire(path, signal => fetchResource(path, signal));
        return () => { lifecycle.active = false; release(); };
    }, [path, resources, lifecycle]);
    const reload = useCallback(() => path && lifecycle.active ? resources.load(path, true) : Promise.resolve(), [path, resources, lifecycle]);
    const setData = useCallback((data: T | null) => {
        if (path && lifecycle.active) resources.replace(path, data);
    }, [path, resources, lifecycle]);
    return { data: state.data as T | null, loading: !!path && (state.loading || (!state.updatedAt && !state.error)), error: state.error, reload, setData };
}
