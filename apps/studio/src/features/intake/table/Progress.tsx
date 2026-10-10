import { Banner, Button, DataTable } from '@ulpin/ui';
import { ApiError } from '@ulpin/api-client';
import { refusalOf } from '../../review/candidates/commands';
import type { MappingJob, RawJob } from './types';

export function TableRefusal({ error, retry }: { error: unknown; retry?: () => void }) {
  const refusal = refusalOf(error);
  return (
    <div className="ul-stack" role="alert">
      <Banner tone="warning">{refusal.message}{refusal.code ? ` (${refusal.code})` : ''}</Banner>
      {error instanceof ApiError && error.status === 429 ? (
        <p className="ul-help">Queued behind another import. Retry to request admission again.</p>
      ) : null}
      {retry ? <Button onClick={retry}>Retry</Button> : null}
    </div>
  );
}

export function Progress({ raw, mapping, fallback, reconnect, rawReason, mappingReason }: {
  raw?: RawJob; mapping?: MappingJob; fallback: boolean; reconnect: () => void;
  rawReason?: string | null; mappingReason?: string | null;
}) {
  const rows = [{ name: 'Raw rows', job: raw, reason: rawReason },
    { name: 'Field mapping', job: mapping, reason: mappingReason }];
  return (
    <section className="ul-panel" aria-label="Import progress">
      <div className="ul-panel__head">
        <h2 className="ul-heading">Import progress</h2>
        <span className="ul-caption" role="status">{fallback ? 'Polling · stream unavailable' : 'Event stream'}</span>
        {fallback ? <Button variant="ghost" onClick={reconnect}>Reconnect stream</Button> : null}
      </div>
      <DataTable caption="Job progress" rows={rows} rowKey={(row) => row.name} columns={[
        { header: 'Job', cell: (row) => row.name },
        { header: 'Status', cell: (row) =>
          row.job?.status.replaceAll('_', ' ') ?? 'Unknown · job status unavailable' },
        { header: 'Chunks published', numeric: true, cell: (row) => row.job?.nextPublishIndex ?? 'Unknown' },
        { header: 'Records', numeric: true, cell: (row) => row.job?.records ?? 'Unknown' },
        { header: 'Issue', cell: (row) => {
          if (!row.job) return 'Unknown';
          if (!row.job.issueCode) return 'None reported';
          return <span>{row.job.issueCode} · {row.reason ?? 'No reason supplied by the server'}</span>;
        } },
      ]} />
      {mapping?.proposal?.validationErrors.length ? (
        <div className="ul-pad">{mapping.proposal.validationErrors.join(' · ')}</div>
      ) : null}
    </section>
  );
}
