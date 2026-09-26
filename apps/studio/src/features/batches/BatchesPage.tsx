import { useQueries } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CircleNotch, FilePlus, Stack, WarningCircle, X } from '@phosphor-icons/react';
import { api, unwrap } from '@ulpin/api-client';
import { Button, EmptyState, FilterChip, Icon, formatCount, formatDateTime, formatRelative } from '@ulpin/ui';
import { queryKeys, useWorkQueue, type WorkItem, type WorkStatusFilter } from '../../api/queries';
import { classificationLabel, nextAction } from './nextAction';
import styles from './BatchesPage.module.css';

const FILTERS: { value: WorkStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'recorded', label: 'Recorded' },
];

/** S1 Batches (GOAL override 7): label, next action, time; count cards become filter chips. */
export function BatchesPage() {
  const [params, setParams] = useSearchParams();
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'all') as WorkStatusFilter;
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const queue = useWorkQueue(status, q, page);

  const counts = useQueries({
    queries: FILTERS.map((filter) => ({
      queryKey: [...queryKeys.workQueue(filter.value, q, 1), 'count'],
      queryFn: async () => unwrap(await api.GET('/api/v1/work-queue', { params: { query: { status: filter.value, q: q || undefined } } })).total,
      staleTime: 15_000,
    })),
  });

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) if (value === null) next.delete(key); else next.set(key, value);
    setParams(next);
  };

  const totalPages = queue.data ? Math.max(1, Math.ceil(queue.data.total / queue.data.pageSize)) : 1;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className="ul-title">Batches</h1>
        <Link to="/studio/add-files" className="ul-btn ul-btn--primary">
          <Icon icon={FilePlus} />
          Add files
        </Link>
      </div>

      <div className={styles.filters} role="group" aria-label="Filter batches">
        {FILTERS.map((filter, index) => (
          <FilterChip
            key={filter.value}
            label={filter.label}
            count={counts[index]?.data}
            pressed={status === filter.value}
            onToggle={() => update({ status: filter.value === 'all' ? null : filter.value, page: null })}
          />
        ))}
        {q ? (
          <span className={styles.query}>
            Matching “{q}”
            <Button variant="ghost" iconOnly icon={X} aria-label="Clear search" onClick={() => update({ q: null, page: null })} />
          </span>
        ) : null}
      </div>

      <BatchesBody
        items={queue.data?.items}
        pending={queue.isPending}
        error={queue.error}
        retry={() => void queue.refetch()}
        filtered={status !== 'all' || Boolean(q)}
      />

      {queue.data && totalPages > 1 ? (
        <nav className={styles.pager} aria-label="Pages">
          <Button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</Button>
          <span className="ul-body-sm">Page {formatCount(page)} of {formatCount(totalPages)}</span>
          <Button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>Next</Button>
        </nav>
      ) : null}
    </div>
  );
}

function BatchesBody({ items, pending, error, retry, filtered }: {
  items: WorkItem[] | undefined; pending: boolean; error: Error | null; retry: () => void; filtered: boolean;
}) {
  if (pending) {
    return (
      <div className={styles.table} aria-busy="true" aria-label="Loading batches">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className={`ul-skeleton ${styles.skeletonRow}`} />)}
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState icon={WarningCircle} title="Batches could not be loaded" action={<Button onClick={retry}>Try again</Button>}>
        {error.message} Check that the Studio API is running on this computer, then try again.
      </EmptyState>
    );
  }
  if (!items?.length) {
    return filtered ? (
      <EmptyState icon={Stack} title="No batches match">Clear the filter or search to see every batch.</EmptyState>
    ) : (
      <EmptyState
        icon={Stack}
        title="No batches yet"
        action={<Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}
      >
        Add plans, survey files or GIS layers to start a batch.
      </EmptyState>
    );
  }
  return (
    <table className={`ul-table ${styles.table}`}>
      <colgroup>
        <col />
        <col className={styles.colArea} />
        <col className={styles.colSources} />
        <col className={styles.colTime} />
        <col className={styles.colAction} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Batch</th>
          <th scope="col">Area</th>
          <th scope="col" className="ul-r">Sources</th>
          <th scope="col">Updated</th>
          <th scope="col">Next action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => <BatchRow key={`${item.kind}:${item.id}`} item={item} />)}
      </tbody>
    </table>
  );
}

function BatchRow({ item }: { item: WorkItem }) {
  const action = nextAction(item);
  const areaSameAsName = item.areaName === item.name;
  return (
    <tr>
      <td>
        <div className={styles.name}>{item.name}</div>
        <div className={styles.meta}>{classificationLabel(item)}</div>
      </td>
      <td className={styles.area}>
        {item.areaName && !areaSameAsName ? item.areaName : <span className={styles.none}>No area</span>}
      </td>
      <td className="ul-r ul-num">{formatCount(item.sourceCount)}</td>
      <td><time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>{formatRelative(item.updatedAt)}</time></td>
      <td>
        {action.href ? (
          <Link to={action.href} className={`${styles.action} ${styles[`tone_${action.tone}`] ?? ''}`}>
            {action.label}
            <Icon icon={ArrowRight} size={16} />
          </Link>
        ) : (
          <span className={styles.waiting}>
            <Icon icon={CircleNotch} size={16} className={styles.spin} />
            {action.label}
          </span>
        )}
      </td>
    </tr>
  );
}
