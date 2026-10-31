import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CircleNotch, FilePlus, MagnifyingGlass, Stack, WarningCircle } from '@phosphor-icons/react';
import { Button, EmptyState, Icon, formatDateTime, formatRelative } from '@ulpin/ui';
import { useWorkQueue, type WorkItem } from '../../api/queries';
import { BATCH_COLUMNS, COLUMN_HEADERS, type BatchColumn } from './columns';
import { nextAction } from './nextAction';
import { StatusChip } from '../intake/StatusChip';
import { batchChip } from '../intake/status-chip';
import styles from './BatchesPage.module.css';

/** Batches: name, batch-wide progress, next action and time, read only from the work queue. */
export function BatchesPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const queue = useWorkQueue('all', q, 1);
  const items = queue.data?.items ?? [];

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) if (value === null || value === '') next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className={styles.page}>
      <section className={styles.main}>
        <div className={styles.head}>
          <h1 className="ul-title">Batches</h1>
          <label className={styles.search}>
            <Icon icon={MagnifyingGlass} size={16} />
            <input type="search" aria-label="Search batches" placeholder="Search" value={q} onChange={(e) => update({ q: e.target.value })} />
          </label>
        </div>
        <BatchesBody items={items} pending={queue.isPending}
          error={queue.error} retry={() => void queue.refetch()} filtered={Boolean(q)} />
      </section>
    </div>
  );
}

function BatchesBody({ items, pending, error, retry, filtered }: {
  items: WorkItem[]; pending: boolean; error: Error | null; retry: () => void; filtered: boolean;
}) {
  if (pending) {
    return (
      <div className={styles.table} aria-busy="true" aria-label="Loading batches">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className={`ul-skeleton ${styles.skeletonRow}`} />)}
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState icon={WarningCircle} title="Batches could not be loaded" action={<Button onClick={retry}>Try again</Button>}>
        {error.message} Check that the Studio API is running, then retry.
      </EmptyState>
    );
  }
  if (!items.length) {
    return filtered ? (
      <EmptyState icon={Stack} title="No batches match" />
    ) : (
      <EmptyState icon={Stack} title="No batches yet"
        action={<Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>} />
    );
  }
  return (
    <div className={`ul-panel ${styles.table}`} role="table" aria-label="Batches">
      <div className={styles.row} role="row" data-head>
        {BATCH_COLUMNS.map((column) => (
          <span key={column} role="columnheader" className={column === 'updated' ? styles.r : undefined}>
            {COLUMN_HEADERS[column]}
          </span>
        ))}
      </div>
      {items.map((item) => <BatchRow key={item.id} item={item} />)}
    </div>
  );
}

function BatchRow({ item }: { item: WorkItem }) {
  const { label, href } = nextAction(item);
  const area = item.areaName === item.name ? null : item.areaName;
  const cells: Record<BatchColumn, ReactNode> = {
    batch: (
      <span key="batch" role="cell" className={styles.what}><b>{item.name}</b>{area ? <span>{area}</span> : null}</span>
    ),
    step: <span key="step" role="cell">{stepCell(item.intakeSummary)}</span>,
    waiting: <span key="waiting" role="cell">{item.intakeSummary?.waiting || null}</span>,
    next: (
      <span key="next" role="cell" className={styles.next}>
        {href ? <>{label}<Icon icon={ArrowRight} size={16} /></> : <span className={styles.waiting}><Icon icon={CircleNotch} size={16} className={styles.spin} />{label}</span>}
      </span>
    ),
    updated: (
      <span key="updated" role="cell" className={`${styles.r} ${styles.time}`}>
        <time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>{timeOf(item.updatedAt)}</time>
      </span>
    ),
  };
  const content = BATCH_COLUMNS.map((column) => cells[column]);
  return href
    ? <Link to={href} state={{ caseRow: item }} className={styles.row} role="row">{content}</Link>
    : <div className={styles.row} role="row">{content}</div>;
}

/** The batch's chip when its step is a chip state; otherwise the step name. */
function stepCell(summary: WorkItem['intakeSummary']): ReactNode {
  const chip = summary ? batchChip(summary) : null;
  return chip ? <StatusChip chip={chip} /> : summary?.step;
}

/** Today: 14:10. Otherwise the relative day. */
function timeOf(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return formatRelative(iso);
}
