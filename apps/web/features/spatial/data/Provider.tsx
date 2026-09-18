"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ResourceCache } from "./resource-cache";
import { MapSessions } from "./session";
const Context = createContext<{
    resources: ResourceCache;
    sessions: MapSessions;
} | null>(null);
export function SpatialDataProvider({ children }: {
    children: ReactNode;
}) {
    const [value] = useState(() => ({ resources: new ResourceCache(), sessions: new MapSessions() }));
    return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** Standalone legacy callers get an isolated store; routed pages share the layout provider. */
export function useSpatialServices() { const shared = useContext(Context); const [local] = useState(() => ({ resources: new ResourceCache(), sessions: new MapSessions() })); return shared || local; }
