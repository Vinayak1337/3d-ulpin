import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Check, FilePlus, MapPin, Tray, Trash, X } from '@phosphor-icons/react';
import type { RegisterRequest, RequestState } from '@ulpin/api-client/draft';
import { api, unwrap } from '@ulpin/api-client';
import {
  Badge, Button, DataTable, DescriptionList, EmptyState, Icon, SegmentedControl, Skeleton, Tabs, UlpinCode,
  formatDateTime, formatRelative,
} from '@ulpin/ui';
import {
  decideRegisterRequest, featureCode, queryKeys, useAreas, useRegisterRequests, type AreaFeature, type RequestFilter,
} from '../../api/queries';
import { DeleteDialog } from '../manage/DeleteDialog';
import { REQUEST_KINDS } from '../../local/requestKinds';
import { isServed } from '../../local/routes';
import { IDENTIFIER_HEADERS, NOT_STATED, identifierColumns } from './buildingColumns';
import { buildingCount, indexView } from './indexView';
import styles from './Requests.module.css';

const STATE_LABEL: Record<RequestState, string> = { submitted: 'New', in_review: 'In review', accepted: 'Accepted', rejected: 'Rejected' };
const STATE_TONE: Record<RequestState, 'primary' | 'warning' | 'success' | 'danger'> = { submitted: 'primary', in_review: 'warning', accepted: 'success', rejected: 'danger' };
const KIND_LABEL = Object.fromEntries(Object.entries(REQUEST_KINDS).map(([k, v]) => [k, v.short])) as Record<RegisterRequest['kind'], string>;

export const requestTitle = (r: Pick<RegisterRequest, 'kind' | 'buildingName' | 'recordName'>) =>
  REQUEST_KINDS[r.kind].title(r.buildingName, r.recordName);

/**
 * Register: requests from the public portal for officers to review (a building's register, or a
 * correction to a released record), and the buildings of every area, recorded in the registry or not.
 */
export function RegistryIndex() {
  const [params, setParams] = useSearchParams();
  const open = useRegisterRequests('open');
  const view = indexView(params.get('tab'), open.data);
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h1 className="ul-title">Register</h1>
          <p>Requests from the public portal, and the buildings of every area, recorded or not.</p>
        </div>
        <div className={styles.tabs}>
          <Tabs label="Register" value={view} onChange={(tab) => setParams({ tab })}
            tabs={[{ value: 'requests', label: 'Requests', count: open.data?.length }, { value: 'buildings', label: 'Buildings' }]} />
        </div>
      </header>
      {view === 'requests' ? <RequestsView /> : <BuildingsView />}
    </div>
  );
}

function emptyRequestsText(filter: RequestFilter, unserved: boolean): { title: string; text: string } {
  if (unserved) return { title: 'Requests are not available', text: 'This API does not serve requests from the public portal yet.' };
  return {
    title: filter === 'open' ? 'No open requests' : 'Nothing here',
    text: 'Citizens file requests from a building or record page on the public portal.',
  };
}

function RequestsView() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('state') as RequestFilter | null) ?? 'open';
  const list = useRegisterRequests(filter);
  const all = useRegisterRequests('all');
  const selectedRef = params.get('ref');
  const items = list.data ?? [];
  const emptyRequests = emptyRequestsText(filter, list.data === null);
  const selected = all.data?.find((r) => r.ref === selectedRef) ?? null;
  const set = (patch: Record<string, string | null>) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) if (v === null) n.delete(k); else n.set(k, v);
    return n;
  }, { replace: true });

  // Open the newest request when none is chosen.
  useEffect(() => {
    if (!selectedRef && items[0]) set({ ref: items[0].ref });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRef, items[0]?.ref]);

  return (
    <div className={styles.split}>
      <div className={styles.listCol}>
        <div className={styles.filter}>
          <SegmentedControl label="Show requests" value={filter} onChange={(v) => set({ state: v === 'open' ? null : v, ref: null })}
            options={[{ value: 'open', label: 'Open' }, { value: 'accepted', label: 'Accepted' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />
        </div>
        {list.isPending ? <div className={styles.list}><Skeleton /><Skeleton /><Skeleton /></div> : items.length ? (
          <ul className={styles.list} aria-label="Requests">
            {items.map((r) => (
              <li key={r.ref}>
                <button type="button" className={styles.row} aria-current={r.ref === selectedRef} onClick={() => set({ ref: r.ref })}>
                  <span className={styles.rowTop}>
                    <span className={styles.rowTitle}>{requestTitle(r)}</span>
                    {r.state === 'submitted' ? <span className={styles.new} aria-label="New" /> : null}
                  </span>
                  <span className={styles.rowMeta}>
                    <span className="ul-mono">{r.ref}</span><span>·</span><span>{KIND_LABEL[r.kind]}</span><span>·</span>
                    <span>{r.applicant.name}</span><span>·</span><span>{formatRelative(r.submittedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <EmptyState icon={Tray} title={emptyRequests.title}>{emptyRequests.text}</EmptyState>
          </div>
        )}
      </div>
      {selected ? <RequestDetail key={selected.ref} request={selected} /> : <div />}
    </div>
  );
}

function RequestDetail({ request: r }: { request: RegisterRequest }) {
  const client = useQueryClient();
  const areas = useAreas();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<RequestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const areaId = areas.data?.[0]?.id ?? null;
  const decide = async (state: RequestState) => {
    setBusy(state);
    setError(null);
    try {
      await decideRegisterRequest(r.ref, state, note.trim() || null);
      setNote('');
      await client.invalidateQueries({ queryKey: ['register-requests'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be updated.');
    } finally {
      setBusy(null);
    }
  };
  const open = r.state === 'submitted' || r.state === 'in_review';
  const mapLink = areaId ? `/studio/areas/${areaId}?feature=${r.buildingId}&mode=building` : null;

  return (
    <section className={styles.detail} aria-label={`Request ${r.ref}`}>
      <div className={styles.detailHead}>
        <div className={styles.headRow}>
          <span className="ul-mono ul-muted">{r.ref}</span>
          <Badge tone={STATE_TONE[r.state]} icon={null}>{STATE_LABEL[r.state]}</Badge>
          <Badge icon={null}>{KIND_LABEL[r.kind]}</Badge>
        </div>
        <h2 className="ul-title">{requestTitle(r)}</h2>
        <UlpinCode code={r.buildingCode} copyable />
      </div>

      <DescriptionList items={[
        { label: 'Applicant', value: `${r.applicant.name} · ${r.applicant.relation}` },
        { label: 'Mobile', value: <span className="ul-mono">+91 {r.applicant.mobile.slice(0, 5)} {r.applicant.mobile.slice(5)}</span> },
        { label: 'Filed', value: formatDateTime(r.submittedAt) },
        ...(r.recordName ? [{ label: 'Record', value: r.recordName }] : []),
        {
          label: 'Documents',
          value: r.files.length ? (
            <ul className={styles.files}>{r.files.map((f) => <li key={f.name}><span>{f.name}</span><span className="ul-muted ul-num">{formatSize(f.bytes)}</span></li>)}</ul>
          ) : <span className="ul-muted">None attached</span>,
        },
      ]} />

      <blockquote className={styles.message}>{r.message}</blockquote>

      <div className={styles.actions}>
        {mapLink ? <Link to={mapLink} className="ul-btn"><Icon icon={MapPin} />Open on map</Link> : null}
        <Link to={`/studio/properties/${r.buildingId}/register`} className="ul-btn">Open register</Link>
        {(r.kind === 'register' || r.kind === 'floors') && r.state === 'accepted' ? (
          <Link to={`/studio/add-files?feature=${r.buildingId}`} className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>
        ) : null}
      </div>

      {open ? (
        <div className={styles.decide}>
          <label className="ul-field" style={{ maxWidth: 'none' }}>
            <span className="ul-label">Note to the applicant</span>
            <textarea className="ul-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder={r.kind === 'register' || r.kind === 'floors' ? 'For example: we will record the floors from the documents you attached.' : r.kind === 'residents' ? 'For example: the holder will be updated after the deed is verified at the Sub-Registrar.' : 'For example: the carpet area will be re-measured from the sanctioned plan.'} />
          </label>
          <div className={styles.actions}>
            {r.state === 'submitted' ? <Button variant="soft" disabled={Boolean(busy)} onClick={() => void decide('in_review')}>{busy === 'in_review' ? 'Taking up…' : 'Take up'}</Button> : null}
            <Button variant="primary" icon={Check} disabled={Boolean(busy)} onClick={() => void decide('accepted')}>{busy === 'accepted' ? 'Accepting…' : 'Accept'}</Button>
            <Button variant="danger" icon={X} disabled={Boolean(busy) || !note.trim()} title={note.trim() ? undefined : 'Write a reason first'} onClick={() => void decide('rejected')}>
              {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
            </Button>
            <span className="ul-help">Rejecting needs a reason. The applicant sees your note.</span>
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
      ) : null}

      <div className="ul-stack">
        <h3 className="ul-label ul-muted">History</h3>
        <ol className={styles.history}>
          {r.history.map((h) => (
            <li key={h.at + h.state}>
              <span className={styles.dot} />
              <span>
                <b>{STATE_LABEL[h.state] === 'New' ? 'Filed' : STATE_LABEL[h.state]}</b> · {h.by} · <span className="ul-muted">{formatDateTime(h.at)}</span>
                {h.note ? <><br /><span className="ul-muted">{h.note}</span></> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const canDeleteBuilding = isServed('DELETE', '/api/v1/buildings/:buildingId');
const canDeleteArea = isServed('DELETE', '/api/v1/areas/:areaId');

const formatSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Open requests of a building; unknown while the API serves no requests. */
function OpenRequests({ count }: { count: number | null }) {
  if (count === null) return <span className="ul-unknown">Unknown</span>;
  return count ? <>{count}</> : <span className="ul-muted">0</span>;
}

/** An identifier as the read holds it; a building whose read states none says so, with no assignment state. */
function Identifier({ value }: { value: string | null | undefined }) {
  return value ? <span className="ul-mono">{value}</span> : <span className="ul-unknown">{NOT_STATED}</span>;
}

function BuildingsView() {
  const areas = useAreas();
  const requests = useRegisterRequests('open');
  const [target, setTarget] = useState<{ kind: 'area' | 'building'; id: string; name: string; detail: string } | null>(null);
  const contexts = useQueries({
    queries: (areas.data ?? []).map((area) => ({
      queryKey: queryKeys.areaContext(area.id),
      queryFn: async () => unwrap(await api.GET('/api/v1/areas/{areaId}/context', { params: { path: { areaId: area.id } } })),
      staleTime: 30_000,
    })),
  });
  if (areas.isPending) return <div className={styles.buildings}><Skeleton height={28} width="30%" /><Skeleton /><Skeleton /></div>;
  if (!areas.data?.length) {
    return (
      <div className={styles.empty}>
        <EmptyState icon={MapPin} title="No buildings recorded yet" action={<Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}>
          Buildings appear here once an area import is committed.
        </EmptyState>
      </div>
    );
  }
  const openFor = (id: string) => requests.data?.filter((r) => r.buildingId === id).length ?? null;
  return (
    <div className={styles.buildings}>
      {areas.data.map((area, i) => {
        const context = contexts[i]?.data;
        const buildings = (context?.displayFeatures ?? context?.features)?.filter((f) => f.kind === 'building') ?? [];
        return (
          <section key={area.id} className="ul-stack">
            <div className={styles.areaHead}>
              <h2 className="ul-heading">
                {area.name} <span className="ul-caption">{buildingCount(buildings.length)}</span>
              </h2>
              <Link to={`/studio/areas/${area.id}`} className="ul-btn ul-btn--ghost"><Icon icon={MapPin} />Open map</Link>
              {canDeleteArea ? (
                <Button variant="ghost" icon={Trash} onClick={() => setTarget({
                  kind: 'area', id: area.id, name: area.name,
                  detail: `${area.name} and its ${buildingCount(buildings.length)}, parcels, roads and utilities `
                    + 'are deleted, with every building register in it.',
                })}>Delete area</Button>
              ) : null}
            </div>
            {contexts[i]?.isPending ? <Skeleton height={200} /> : (
              <DataTable<AreaFeature>
                caption={`Buildings in ${area.name}`}
                rows={buildings}
                rowKey={(b) => b.id}
                columns={[
                  { header: 'Building', cell: (b) => <Link to={`/studio/properties/${b.id}/register`}>{b.name}</Link> },
                  ...identifierColumns(buildings.map(featureCode)).map((column) => ({
                    header: IDENTIFIER_HEADERS[column], width: '300px',
                    cell: (b: AreaFeature) => (
                      <Identifier value={column === 'identifier' ? b.identifier : featureCode(b)} />
                    ),
                  })),
                  { header: 'Open requests', numeric: true, width: '120px', cell: (b) => <OpenRequests count={openFor(b.id)} /> },
                  {
                    header: 'Actions', width: '150px', cell: (b) => (
                      <span className={styles.tableActions}>
                        <Link to={`/studio/areas/${area.id}?feature=${b.id}&mode=building`} className="ul-btn ul-btn--ghost ul-btn--icon" aria-label={`Show ${b.name} on the map`} title="Show on map"><Icon icon={MapPin} /></Link>
                        {canDeleteBuilding ? (
                          <Button variant="ghost" iconOnly icon={Trash} aria-label={`Delete ${b.name}`} title="Delete building"
                            onClick={() => setTarget({ kind: 'building', id: b.id, name: b.name, detail: `${b.name} and its register (floors, units, findings and history) are deleted from ${area.name}.` })} />
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </section>
        );
      })}
      {target ? <DeleteDialog target={target} onClose={() => setTarget(null)} onDeleted={() => setTarget(null)} /> : null}
    </div>
  );
}
