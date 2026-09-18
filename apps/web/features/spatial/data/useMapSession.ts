"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useSpatialServices } from "./Provider";
import type { MapSession } from "./session";
export function useMapSession(key: string) {
    const { sessions } = useSpatialServices();
    const subscribe = useCallback((fn: () => void) => sessions.subscribe(key, fn), [sessions, key]);
    const get = useCallback(() => sessions.get(key), [sessions, key]);
    const value = useSyncExternalStore(subscribe, get, get);
    const update = useCallback((patch: Partial<MapSession>) => sessions.patch(key, patch), [sessions, key]);
    return [value, update] as const;
}
