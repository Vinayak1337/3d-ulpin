export type ResourceSnapshot<T> = Readonly<{
    data: T | null;
    loading: boolean;
    error: string;
    updatedAt: number;
}>;
type Loader = (signal: AbortSignal) => Promise<unknown>;
type Entry = {
    snapshot: ResourceSnapshot<unknown>;
    listeners: Set<() => void>;
    consumers: number;
    generation: number;
    stale: boolean;
    touched: number;
    loader?: Loader;
    controller?: AbortController;
    pending?: Promise<void>;
};
/** One cache per application provider, never a cross-request or persistent PII cache. */
export class ResourceCache {
    private entries = new Map<string, Entry>();
    constructor(private readonly limit = 64, private readonly now = () => Date.now(), private readonly staleMs = 30000) {
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new Error("Invalid cache limit");
    }
    private entry(key: string): Entry {
        let e = this.entries.get(key);
        if (!e) {
            e = { snapshot: Object.freeze({ data: null, loading: false, error: "", updatedAt: 0 }), listeners: new Set(), consumers: 0, generation: 0, stale: true, touched: this.now() };
            this.entries.set(key, e);
        }
        return e;
    }
    read<T>(key: string): ResourceSnapshot<T> { return this.entry(key).snapshot as ResourceSnapshot<T>; }
    subscribe(key: string, listener: () => void) { const e = this.entry(key); e.listeners.add(listener); return () => { e.listeners.delete(listener); }; }
    private emit(e: Entry, patch: Partial<ResourceSnapshot<unknown>>) { e.snapshot = Object.freeze({ ...e.snapshot, ...patch }); for (const notify of [...e.listeners])
        notify(); }
    acquire(key: string, loader: Loader) {
        const e = this.entry(key);
        e.consumers++;
        e.loader = loader;
        e.touched = this.now();
        if (this.now() - e.snapshot.updatedAt > this.staleMs)
            e.stale = true;
        void this.load(key);
        this.trim();
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            e.consumers--;
            // React Strict Mode and an immediate route handoff can reacquire before this microtask.
            queueMicrotask(() => { if (!e.consumers && e.controller) {
                e.generation++;
                e.controller.abort();
                e.controller = undefined;
                e.pending = undefined;
                e.stale = true;
                this.emit(e, { loading: false });
            } this.trim(); });
        };
    }
    async load(key: string, force = false): Promise<void> {
        const e = this.entry(key);
        e.touched = this.now();
        if (!e.loader)
            return;
        if (e.pending && !force)
            return e.pending;
        if (!e.stale && !force)
            return;
        e.controller?.abort();
        const controller = new AbortController(), generation = ++e.generation;
        e.controller = controller;
        this.emit(e, { loading: true, error: "" });
        const pending = (async () => {
            try {
                const data = await e.loader!(controller.signal);
                if (e.generation === generation && !controller.signal.aborted) {
                    e.stale = false;
                    this.emit(e, { data, loading: false, error: "", updatedAt: this.now() });
                }
            }
            catch (error) {
                if (e.generation === generation && !controller.signal.aborted)
                    this.emit(e, { loading: false, error: error instanceof Error ? error.message : "Unable to load resource" });
            }
            finally {
                if (e.generation === generation) {
                    e.controller = undefined;
                    e.pending = undefined;
                }
                this.trim();
            }
        })();
        e.pending = pending;
        return pending;
    }
    replace<T>(key: string, data: T | null) { const e = this.entry(key); e.generation++; e.controller?.abort(); e.controller = undefined; e.pending = undefined; e.stale = false; e.touched = this.now(); this.emit(e, { data, loading: false, error: "", updatedAt: this.now() }); }
    invalidate(predicate: (key: string) => boolean = () => true) { for (const [key, e] of this.entries) {
        if (!predicate(key))
            continue;
        e.stale = true;
        if (e.consumers)
            void this.load(key, true);
    } }
    private trim() { if (this.entries.size <= this.limit)
        return; const idle = [...this.entries].filter(([, e]) => !e.consumers && !e.listeners.size && !e.pending).sort((a, b) => a[1].touched - b[1].touched); for (const [key] of idle) {
        if (this.entries.size <= this.limit)
            break;
        this.entries.delete(key);
    } }
    dispose() { for (const e of this.entries.values()) {
        e.generation++;
        e.controller?.abort();
        e.listeners.clear();
    } this.entries.clear(); }
    get size() { return this.entries.size; }
}
