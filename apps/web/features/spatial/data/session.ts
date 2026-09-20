import type {LocalOrbitState} from './local-session';
export interface MapCamera {
    longitude: number;
    latitude: number;
    height: number;
    heading: number;
    pitch: number;
    roll: number;
}
export interface MapSelection {
    entityId: string;
    representationId?: string;
    detailId?: string;
}
export interface MapSession {
    localOrbit?:LocalOrbitState;
    selection: MapSelection | null;
    mode: "3d" | "2d";
    camera: MapCamera | null;
}
const initial = (): MapSession => ({ selection: null, mode: "3d", camera: null });
export function validCamera(c: unknown): c is MapCamera {
    if (!c || typeof c !== "object")
        return false;
    const x = c as MapCamera;
    return [x.longitude, x.latitude, x.height, x.heading, x.pitch, x.roll].every(Number.isFinite) && Math.abs(x.latitude) <= Math.PI / 2 && Math.abs(x.longitude) <= Math.PI && x.height > -7000000;
}
/** Transient per-provider view state, keyed by world/snapshot scope, not by display mesh ID. */
export class MapSessions {
    private values = new Map<string, MapSession>();
    private listeners = new Map<string, Set<() => void>>();
    constructor(private readonly limit = 128) { }
    get(key: string) { let value = this.values.get(key); if (!value) {
        value = initial();
        this.values.set(key, value);
    } return value; }
    subscribe(key: string, fn: () => void) { const set = this.listeners.get(key) || new Set<() => void>(); set.add(fn); this.listeners.set(key, set); return () => { set.delete(fn); if (!set.size)
        this.listeners.delete(key); }; }
    patch(key: string, patch: Partial<MapSession>) { if (patch.camera && !validCamera(patch.camera))
        throw new Error("Invalid camera snapshot"); const current = this.get(key); const next = { ...current, ...patch, camera: patch.camera ? { ...patch.camera } : patch.camera === null ? null : current.camera, selection: patch.selection ? { ...patch.selection } : patch.selection === null ? null : current.selection }; this.values.delete(key); this.values.set(key, next); for (const fn of this.listeners.get(key) || [])
        fn(); for (const old of this.values.keys()) {
        if (this.values.size <= this.limit)
            break;
        if (old !== key && !this.listeners.has(old))
            this.values.delete(old);
    } }
    clear() { this.values.clear(); for (const set of this.listeners.values())
        for (const fn of set)
            fn(); }
}
