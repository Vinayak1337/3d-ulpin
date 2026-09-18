"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
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
    useEffect(() => { if (!path)
        return; return resources.acquire(path, signal => fetchResource(path, signal)); }, [path, resources]);
    const reload = useCallback(() => path ? resources.load(path, true) : Promise.resolve(), [path, resources]);
    const setData = useCallback((data: T | null) => { if (path)
        resources.replace(path, data); }, [path, resources]);
    return { data: state.data as T | null, loading: !!path && (state.loading || (!state.updatedAt && !state.error)), error: state.error, reload, setData };
}
