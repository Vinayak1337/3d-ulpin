/** Opt-in local demo transport. The scene and real registry APIs remain unchanged. */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Schemas } from '@ulpin/api-client';
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

/** SSE owns the demo area cache. Reconnect starts with one atomic snapshot, then monotone deltas. */
export function useDemoAreaStream(areaId: string | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (!isDemoId(areaId)) return;
    const key = ['areas', areaId, 'context'];
    const stream = new EventSource(`/api/demo/areas/${areaId}/events`);
    let sequence = -1;
    let frame = 0;
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
          displayFeatures: message.features ? [...(previous.displayFeatures ?? []), ...withCodes(message.features as NonNullable<AreaContext["displayFeatures"]>)!] : previous.displayFeatures,
          packages: [message.package] };
      });
      client.setQueryData(['import-packages', message.package.id], message.package);
      // Let React and the existing scene apply a real chunk before accepting the next one.
      if (event.type === 'chunk') frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { void fetch(`/api/demo/areas/${areaId}/ack`, { method: 'POST' }); });
      });
      if (event.type === 'complete' || event.type === 'failed' || event.type === 'snapshot' && message.package.state !== 'RECEIVED') {
        stream.close(); void client.invalidateQueries({ queryKey: ['areas'], exact: true });
      }
    };
    for (const type of ['snapshot', 'metadata', 'chunk', 'complete', 'failed']) stream.addEventListener(type, apply as EventListener);
    return () => { cancelAnimationFrame(frame); stream.close(); };
  }, [areaId, client]);
}
