import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, type InvalidateQueryFilters } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { Button, ImportStream, Skeleton, formatCount, type StreamRow } from '@ulpin/ui';
import { isDemoId } from '../../api/demo-import';
import { packageStreaming, queryKeys, useBuildingImport, type AreaContext } from '../../api/queries';

const KINDS: { kinds: string[]; label: string; unit: string }[] = [
  { kinds: ['road', 'public_land'], label: 'Roads and open land', unit: 'features' },
  { kinds: ['parcel'], label: 'Parcels', unit: 'parcels' },
  { kinds: ['building'], label: 'Buildings', unit: 'buildings' },
  { kinds: ['utility'], label: 'Utilities', unit: 'networks' },
];
const EVERY_QUERY: readonly InvalidateQueryFilters[] = [{}];

/** When an import settles, the views it changed read their records again; by default every view does. */
function useSettled(done: boolean, filters = EVERY_QUERY) {
  const client = useQueryClient();
  const was = useRef(done);
  useEffect(() => {
    if (done && !was.current) for (const filter of filters) void client.invalidateQueries(filter);
    was.current = done;
  }, [done, filters, client]);
}

/**
 * What a settled area import changed. The area context is not among them: the read that reported the package
 * settled is its newest. The canonical area and its display summary bring the records saved after their last read,
 * the area list its counts, and the Batches list the package's row.
 */
function settledKeys(areaId: string): InvalidateQueryFilters[] {
  return [
    { queryKey: queryKeys.areas, exact: true },
    { queryKey: queryKeys.areaCanonical(areaId) },
    { queryKey: queryKeys.areaDisplaySummary(areaId) },
    { queryKey: ['work-queue'] },
  ];
}

/**
 * S3: the tray while an area import streams (?package=). Records arrive on the map as they are saved;
 * nothing here moves the camera. While the package streams, its state, quarantine notice and feature counts are
 * read from the area context the map already reads (its unrecorded proposals carry the package id); the package
 * itself is read once it settles, for its name, warnings and skipped features. A demo import's context is the
 * package's own stream, so every feature in it is the package's. `contextFresh`: the context was read since the
 * package was opened; until then the package counts as streaming.
 */
export function ImportTray({ packageId, context, contextFresh = true, drawnBuildings, onClose }: {
  packageId: string; context: AreaContext; contextFresh?: boolean; drawnBuildings?: number; onClose: () => void;
}) {
  const demo = isDemoId(packageId);
  const listed = context.packages.find((pkg) => pkg.id === packageId);
  const running = packageStreaming(context, packageId, contextFresh);
  const read = useQuery({
    queryKey: queryKeys.importPackage(packageId),
    queryFn: async () => unwrap(await api.GET('/api/v1/import-packages/{packageId}', { params: { path: { packageId } } })),
    // A demo package is written into this key by its stream and never read here.
    enabled: !running && !demo,
  });
  // A body cached by another view before the package settled is not this import's answer.
  const pkg = running && !demo ? undefined : read.data;
  // The context's state is the newest; an older package it no longer lists has its own.
  const packageState: string | undefined = listed?.state ?? pkg?.state;
  const proposals = useMemo(
    () => context.displayFeatures.filter((f) => demo || f.proposalPackageId === packageId),
    [context.displayFeatures, demo, packageId],
  );
  const filters = useMemo(() => settledKeys(context.area.id), [context.area.id]);
  useSettled(!running, filters);
  if (packageState === 'FAILED') {
    const warnings = pkg?.warnings.length ? `: ${pkg.warnings.join('; ')}` : '';
    return <div className="ul-panel ul-pad ul-help">Import failed{warnings}. Upload the same files to retry.</div>;
  }
  if (!pkg && !running && !demo) {
    if (read.isPending) return <div className="ul-panel ul-pad"><Skeleton /></div>;
    return <div className="ul-panel ul-pad ul-help">The import could not be read: {read.error?.message}</div>;
  }
  const features: { kind?: string }[] = pkg?.features ?? proposals;
  const quarantine = pkg?.quarantine;
  const notice = listed?.quarantine?.message ?? quarantine?.message;
  const recorded = packageState === 'COMMITTED';
  const rows: StreamRow[] = KINDS.map(({ kinds, label, unit }) => {
    const n = features.filter((f) => kinds.includes(String(f.kind))).length;
    return { id: label, file: label, state: running ? 'running' : 'saved', detail: n ? `${formatCount(n)} ${unit} ${recorded ? 'recorded' : 'to review'}` : running ? 'reading' : 'none' };
  });
  const drawn = demo && drawnBuildings !== undefined ? `${formatCount(drawnBuildings)} buildings drawn` : undefined;
  const title = pkg ? `${running ? 'Importing' : 'Imported'} ${pkg.name}` : `Importing into ${context.area.name}`;
  return (
    <div>
      <ImportStream title={title} rows={rows}
        meta={notice ?? drawn}
        aside={!running ? <Button variant="ghost" onClick={onClose}>Done</Button> : null} />
      {quarantine ? <details className="ul-panel ul-pad">
        <summary>{formatCount(quarantine.rejected)} skipped features</summary>
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
