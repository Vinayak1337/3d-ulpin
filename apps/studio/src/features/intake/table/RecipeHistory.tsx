import { DataTable, formatDateTime } from '@ulpin/ui';
import type { RecipeHistory as History } from './types';

export function RecipeHistory({ revisions }: { revisions: History }) {
  return (
    <details>
      <summary>Recipe revision history · {revisions.length}</summary>
      <DataTable caption="Recipe revisions" rows={revisions} rowKey={(revision) => String(revision.revision)} columns={[
        { header: 'Revision', numeric: true, cell: (revision) => revision.revision },
        { header: 'State', cell: (revision) => revision.state },
        { header: 'Proposed by', cell: (revision) => revision.authoredBy },
        { header: 'Proposed at', cell: (revision) => formatDateTime(revision.authoredAt) },
        { header: 'Approval', cell: (revision) => revision.approval ? (
          <span>{revision.approval.subject} · {formatDateTime(revision.approval.at)}</span>
        ) : 'Not approved' },
      ]} />
    </details>
  );
}
