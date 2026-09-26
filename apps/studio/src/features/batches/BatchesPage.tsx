import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CircleNotch, FilePlus, MagnifyingGlass, Stack, WarningCircle } from '@phosphor-icons/react';
import type { WorkBoard } from '@ulpin/api-client/draft';
import { Badge, Button, EmptyState, FilterChip, Icon, formatDateTime, formatRelative } from '@ulpin/ui';
import { useWorkBoard, useWorkQueue, type WorkItem } from '../../api/queries';
import { nextAction } from './nextAction';
import { STAGES, targetHref, type Stage } from './targets';
import styles from './BatchesPage.module.css';

type BoardItem = WorkBoard['items'][number];

/**
 * S1 Batches: what, stage, next action, readiness and time in aligned columns, with count cards that
 * jump straight to the work. Stage and readiness come from the work board; without it, the next
 * action is derived from the work item alone and those columns stay empty.
 */
export function BatchesPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const stage = STAGES.find((s) => s.value === params.get('stage'))?.value ?? null;
  const queue = useWorkQueue('all', q, 1);
  const board = useWorkBoard().data;
  const byId = new Map(board?.items.map((i) => [i.id, i]) ?? []);
  const items = (queue.data?.items ?? []).filter((item) => !stage || byId.get(item.id)?.stage === stage);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) if (value === null || value === '') next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };
  const countFor = (s: Stage) => queue.data?.items.filter((i) => byId.get(i.id)?.stage === s).length ?? 0;

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
        {board ? (
          <div className={styles.filters} role="group" aria-label="Filter by stage">
            <FilterChip label="All stages" pressed={!stage} count={queue.data?.items.length} onToggle={() => update({ stage: null })} />
            {STAGES.map((s) => <FilterChip key={s.value} label={s.label} count={countFor(s.value)} pressed={stage === s.value} onToggle={() => update({ stage: stage === s.value ? null : s.value })} />)}
          </div>
        ) : null}
        <BatchesBody items={items} board={byId} pending={queue.isPending} error={queue.error} retry={() => void queue.refetch()} filtered={Boolean(stage || q)} />
      </section>
      {board?.counts.length ? (
        <aside className={styles.counts} aria-label="Work at a glance">
          {board.counts.map((c) => (
            <Link key={c.key} to={targetHref(c.target)} className={`ul-panel ${styles.count}`}>
              <span className="ul-num">{c.value}</span>
              <span>{c.label}</span>
            </Link>
          ))}
        </aside>
      ) : null}
    </div>
  );
}

function BatchesBody({ items, board, pending, error, retry, filtered }: {
  items: WorkItem[]; board: Map<string, BoardItem>; pending: boolean; error: Error | null; retry: () => void; filtered: boolean;
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
        {error.message} Check that the Studio API is running, then try again.
      </EmptyState>
    );
  }
  if (!items.length) {
    return filtered ? (
      <EmptyState icon={Stack} title="No batches match">Clear the filter or search to see every batch.</EmptyState>
    ) : (
      <EmptyState icon={Stack} title="No batches yet" action={<Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}>
        Add plans, survey files or GIS layers to start a batch.
      </EmptyState>
    );
  }
  return (
    <div className={`ul-panel ${styles.table}`} role="table" aria-label="Batches">
      <div className={styles.row} role="row" data-head>
        <span role="columnheader">Batch</span><span role="columnheader">Stage</span><span role="columnheader">Next action</span>
        <span role="columnheader">Readiness</span><span role="columnheader" className={styles.r}>Updated</span>
      </div>
      {items.map((item) => <BatchRow key={item.id} item={item} board={board.get(item.id)} />)}
    </div>
  );
}

function BatchRow({ item, board }: { item: WorkItem; board: BoardItem | undefined }) {
  const derived = nextAction(item);
  const label = board?.nextAction.label ?? derived.label;
  const href = board ? targetHref(board.nextAction.target) : derived.href;
  const stage = board ? STAGES.find((s) => s.value === board.stage) : undefined;
  const sub = [item.areaName, board?.detail].filter(Boolean).join(' · ');
  const content = (
    <>
      <span role="cell" className={styles.what}><b>{item.name}</b>{sub ? <span>{sub}</span> : null}</span>
      <span role="cell">{stage ? <Badge tone={stage.tone} icon={null}>{stage.label}</Badge> : null}</span>
      <span role="cell" className={styles.next}>
        {href ? <>{label}<Icon icon={ArrowRight} size={16} /></> : <span className={styles.waiting}><Icon icon={CircleNotch} size={16} className={styles.spin} />{label}</span>}
      </span>
      <span role="cell">{board ? <Readiness met={board.readiness.met} unknown={board.readiness.unknown} of={board.readiness.of} /> : null}</span>
      <span role="cell" className={`${styles.r} ${styles.time}`}>
        <time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>{timeOf(item.updatedAt)}</time>
      </span>
    </>
  );
  return href
    ? <Link to={href} className={styles.row} role="row">{content}</Link>
    : <div className={styles.row} role="row">{content}</div>;
}

/** Six blocks: met, unknown (hatched), not met. No overall score. */
function Readiness({ met, unknown, of }: { met: number; unknown: number; of: number }) {
  return (
    <span className={styles.ready} title={`${met} of ${of} ready${unknown ? `, ${unknown} unknown` : ''}`}>
      <span className={styles.blocks} aria-hidden="true">
        {Array.from({ length: of }, (_, i) => <i key={i} data-state={i < met ? 'met' : i < met + unknown ? 'unknown' : 'open'} />)}
      </span>
      <span className="ul-num ul-muted">{met} of {of}</span>
    </span>
  );
}

/** Today: 14:10. Otherwise the relative day. */
function timeOf(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return formatRelative(iso);
}
