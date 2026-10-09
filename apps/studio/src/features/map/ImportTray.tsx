import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@ulpin/api-client';
import { Button, ImportStream, Skeleton, formatCount, type StreamRow } from '@ulpin/ui';
import { isDemoId } from '../../api/demo-import';
import { unwrapApi, useBuildingImport } from '../../api/queries';

const RUNNING = new Set(['RECEIVED']);
const KINDS: { kinds: string[]; label: string; unit: string }[] = [
  { kinds: ['road', 'public_land'], label: 'Roads and open land', unit: 'features' },
  { kinds: ['parcel'], label: 'Parcels', unit: 'parcels' },
  { kinds: ['building'], label: 'Buildings', unit: 'buildings' },
  { kinds: ['utility'], label: 'Utilities', unit: 'networks' },
];

/** When an import settles, every view reads the new records (Batches, areas, the public portal). */
function useSettled(done: boolean) {
  const client = useQueryClient();
  const was = useRef(done);
  useEffect(() => {
    if (done && !was.current) void client.invalidateQueries();
    was.current = done;
  }, [done, client]);
}

/**
 * S3: the tray while an area import streams (?package=). Records arrive on the map as they are saved;
 * nothing here moves the camera. Polls until the package settles; SSE replaces polling later.
 */
export function ImportTray({ packageId, onClose }: { packageId: string; onClose: () => void }) {
  const pkg = useQuery({
    queryKey: ['import-packages', packageId],
    queryFn: async () => unwrapApi(await api.GET('/api/v1/import-packages/{packageId}', { params: { path: { packageId } } })),
    refetchInterval: (query) => isDemoId(packageId) ? false : (!query.state.data || RUNNING.has(query.state.data.state) ? 700 : false),
  });
  const running = !pkg.data || RUNNING.has(pkg.data.state);
  useSettled(!running);
  if (pkg.isPending) return <div className="ul-panel ul-pad"><Skeleton /></div>;
  if ((pkg.data?.state as string) === 'FAILED') return <div className="ul-panel ul-pad ul-help">Import failed: {pkg.data?.warnings.join('; ')}. Upload the same files to retry; originals are retained.</div>;
  if (pkg.error || !pkg.data) return <div className="ul-panel ul-pad ul-help">The import could not be read: {pkg.error?.message}</div>;
  const features = pkg.data.features as { kind?: string }[];
  const quarantine = pkg.data.quarantine;
  const recorded = pkg.data.state === 'COMMITTED';
  const rows: StreamRow[] = KINDS.map(({ kinds, label, unit }) => {
    const n = features.filter((f) => kinds.includes(String(f.kind))).length;
    return { id: label, file: label, state: running ? 'running' : 'saved', detail: n ? `${formatCount(n)} ${unit} ${recorded ? 'recorded' : 'accepted for review'}` : running ? 'reading' : 'none accepted from this file' };
  });
  return (
    <div>
      <ImportStream title={running ? `Importing ${pkg.data.name}` : `Imported ${pkg.data.name}`} rows={rows}
        meta={quarantine ? quarantine.message : `${formatCount(features.length)} features${running ? '' : recorded ? ' · recorded' : ' · unrecorded proposals'}`}
        aside={!running ? <Button variant="ghost" onClick={onClose}>Done</Button> : null} />
      {quarantine ? <details className="ul-panel ul-pad">
        <summary>{formatCount(quarantine.rejected)} skipped source features</summary>
        <p className="ul-help">Original feature indexes are zero-based. The original is retained unchanged.</p>
        <ul>{quarantine.rejections.map((row) => <li key={row.featureIndex}>
          Feature {row.featureIndex} · source ID {row.sourceKey ?? 'unknown'} · {row.code}: {row.reason}
        </li>)}</ul>
      </details> : null}
    </div>
  );
}

/** The tray while a building's documents import (?building-import=): levels stack up as they are recorded. */
export function BuildingImportTray({ importId, onClose }: { importId: string; onClose: () => void }) {
  const imp = useBuildingImport(importId);
  const running = !imp.data || imp.data.state === 'running';
  useSettled(!running);
  if (imp.isPending) return <div className="ul-panel ul-pad"><Skeleton /></div>;
  if (!imp.data) return <div className="ul-panel ul-pad ul-help">The import could not be read.</div>;
  const rows: StreamRow[] = imp.data.files.map((f) => ({
    id: f.name, file: f.name, state: f.state === 'saved' ? 'saved' : 'running', detail: `${f.detected} · ${f.detail}`,
  }));
  return (
    <ImportStream title={running ? 'Adding floors' : 'Floors added'} rows={rows}
      meta={`${imp.data.levels} levels · ${imp.data.units} units`}
      aside={!running ? <Button variant="ghost" onClick={onClose}>Done</Button> : null} />
  );
}
