import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@ulpin/api-client';
import { ImportStream, Skeleton, formatCount, type StreamRow } from '@ulpin/ui';

const RUNNING = new Set(['RECEIVED']);

/**
 * S3: the tray while an import is open (?package=). Polls the package until it settles; SSE replaces
 * polling when the backend streaming card lands. Nothing here moves the camera.
 */
export function ImportTray({ packageId }: { packageId: string }) {
  const pkg = useQuery({
    queryKey: ['import-packages', packageId],
    queryFn: async () => unwrap(await api.GET('/api/v1/import-packages/{packageId}', { params: { path: { packageId } } })),
    refetchInterval: (query) => (query.state.data && RUNNING.has(query.state.data.state) ? 3000 : false),
  });
  if (pkg.isPending) return <div className="ul-panel ul-pad"><Skeleton /></div>;
  if (pkg.error || !pkg.data) return <div className="ul-panel ul-pad ul-help">The import could not be read: {pkg.error?.message}</div>;
  const data = pkg.data;
  const rows: StreamRow[] = [{
    id: data.id,
    file: data.name,
    state: data.state === 'RECEIVED' ? 'running' : data.state === 'NEEDS_INPUT' ? 'attention' : 'saved',
    detail: `${formatCount(data.features.length)} features · ${stateText(data.state)}${data.warnings.length ? ` · ${formatCount(data.warnings.length)} warnings` : ''}`,
  }];
  return <ImportStream title={`Importing ${data.name}`} meta={`${formatCount(data.features.length)} saved`} rows={rows} />;
}

function stateText(state: string) {
  return ({ RECEIVED: 'reading', NEEDS_INPUT: 'needs input', READY_FOR_REVIEW: 'ready for review', REVIEWED: 'reviewed', COMMITTED: 'recorded' } as Record<string, string>)[state] ?? state.toLowerCase();
}
