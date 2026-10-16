/** Opt-in local demo transport. The scene and real registry APIs remain unchanged. */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Schemas } from '@ulpin/api-client';
import type { SceneEngine } from '@ulpin/scene';
import type { AreaContext } from './queries';
import { buildingCode } from '../local/codes';

/** Every uploaded building carries the proposed 3D ULPIN allotted when its import committed, as area imports do. */
const withCodes = <T extends { id: string; kind: string }>(features: T[] | undefined): T[] | undefined => features?.map((f) => (f.kind === "building" ? { ...f, projectCode: buildingCode(f.id) } : f));
export const demoImportEnabled = (import.meta.env.DEV || import.meta.env.VITE_HOSTED_DEMO === '1') && import.meta.env.VITE_DEMO_IMPORT === '1';
export const isDemoId = (id: string | null | undefined) => demoImportEnabled && Boolean(id?.startsWith('d30d'));

export async function inspectDemoFile(file: File): Promise<Schemas['POST_import_packages_inspect_Response_200_application_json']> {
  const body = new FormData(); body.append('file', file);
  const response = await fetch('/api/demo/inspect', { method: 'POST', body });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message ?? 'The demo upload could not be inspected.');
  return value;
}
export async function startDemoImport(files: File[]): Promise<{ id: string; areaId: string }> {
  const body = new FormData(); body.append('intent', crypto.randomUUID()); for (const file of files) body.append('file', file);
  const response = await fetch('/api/demo/imports', { method: 'POST', body });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message ?? 'The demo import could not start.');
  return value;
}
export async function demoAreas() {
  if (!demoImportEnabled) return [];
  const response = await fetch('/api/demo/areas');
  if (!response.ok) throw new Error('The local demo API is unavailable. Start Studio with pnpm studio:demo.');
  return response.json();
}

const scenes = new Map<string, SceneEngine>();
const sceneListeners = new Map<string, Set<(engine: SceneEngine) => void>>();

/** The map owns the engine; the transport may receive a part before that map mounts. */
export function attachDemoScene(areaId: string, engine: SceneEngine): () => void {
  scenes.set(areaId, engine);
  for (const listener of sceneListeners.get(areaId) ?? []) listener(engine);
  return () => {
    if (scenes.get(areaId) === engine) scenes.delete(areaId);
  };
}

function waitForScene(areaId: string, signal: AbortSignal): Promise<SceneEngine | null> {
  if (signal.aborted) return Promise.resolve(null);
  const engine = scenes.get(areaId);
  if (engine) return Promise.resolve(engine);
  return new Promise((resolve) => {
    const listeners = sceneListeners.get(areaId) ?? new Set();
    sceneListeners.set(areaId, listeners);
    const finish = (engine: SceneEngine | null) => {
      listeners.delete(ready);
      if (!listeners.size) sceneListeners.delete(areaId);
      signal.removeEventListener('abort', cancel);
      resolve(engine);
    };
    const ready = (engine: SceneEngine) => finish(engine);
    const cancel = () => finish(null);
    listeners.add(ready);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** A part with no drawable geometry needs no frame; otherwise only the engine proves completion. */
export async function acknowledgeDemoPart(
  areaId: string, features: AreaContext['displayFeatures'], signal: AbortSignal,
  acknowledge: () => void = () => { void fetch(`/api/demo/areas/${areaId}/ack`, { method: 'POST' }); },
): Promise<void> {
  const drawable = features.filter((feature) => {
    const geometry = feature.geometry as { type: string; coordinates?: unknown[] } | null;
    return (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') && geometry.coordinates?.length;
  });
  if (drawable.length) {
    const engine = await waitForScene(areaId, signal);
    if (!engine) return;
    const buildings = drawable.filter((feature) => feature.kind === 'building').map((feature) => feature.id);
    const base = drawable.filter((feature) => feature.kind !== 'building').map((feature) => feature.id);
    if (!await engine.waitForDrawn(buildings, base, signal)) return;
  }
  if (!signal.aborted) acknowledge();
}

/** SSE owns the demo area cache. Reconnect starts with one atomic snapshot, then monotone deltas. */
export function useDemoAreaStream(areaId: string | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (!isDemoId(areaId)) return;
    const key = ['areas', areaId, 'context'];
    const stream = new EventSource(`/api/demo/areas/${areaId}/events`);
    let sequence = -1;
    const drawing = new AbortController();
    const apply = (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.sequence < sequence) return;
      if (event.type !== 'snapshot' && message.sequence === sequence) return;
      sequence = message.sequence;
      if (event.type === 'snapshot' || event.type === 'metadata') {
        // Keep the loading screen until the normalizer establishes the shared frame.
        if (message.context.area.reference || message.package.state !== 'RECEIVED') client.setQueryData(key, { ...message.context, displayFeatures: withCodes(message.context.displayFeatures) });
      }
      else client.setQueryData<AreaContext>(key, (previous) => {
        if (!previous) return previous;
        return { ...previous, area: message.area ?? previous.area,
          displayFeatures: message.features ? [...previous.displayFeatures, ...withCodes(message.features as AreaContext["displayFeatures"])!] : previous.displayFeatures,
          packages: [message.package] };
      });
      client.setQueryData(['import-packages', message.package.id], message.package);
      if (event.type === 'chunk') {
        void acknowledgeDemoPart(areaId!, message.features ?? [], drawing.signal);
      }
      if (event.type === 'complete' || event.type === 'failed' || event.type === 'snapshot' && message.package.state !== 'RECEIVED') {
        stream.close(); void client.invalidateQueries({ queryKey: ['areas'], exact: true });
      }
    };
    for (const type of ['snapshot', 'metadata', 'chunk', 'complete', 'failed']) stream.addEventListener(type, apply as EventListener);
    return () => { drawing.abort(); stream.close(); };
  }, [areaId, client]);
}
