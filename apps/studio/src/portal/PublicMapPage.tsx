import { useCallback, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { ArrowRight, Buildings, MagnifyingGlass } from '@phosphor-icons/react';
import type { Pick, SceneEngine } from '@ulpin/scene';
import { EmptyState, Icon, LevelRail, Skeleton, StatusBadge } from '@ulpin/ui';
import { PublicScene } from './PublicScene';
import { usePublicAreas, usePublicBuilding, usePublicMap, usePublicSearch } from './queries';
import styles from './Portal.module.css';

/** The public map: an area in 3D, view only. Pick a building to see its released records, then a record to see it on its floor. */
export function PublicMapIndex() {
  const areas = usePublicAreas();
  if (areas.isPending) return <div className={styles.wrap}><Skeleton height={420} /></div>;
  const first = areas.data?.[0];
  if (!first) return <div className={styles.wrap}><EmptyState icon={Buildings} title="No area has released records yet">Released records appear here once recorded.</EmptyState></div>;
  return <Navigate to={`/portal/map/${first.id}`} replace />;
}

export function PublicMapPage() {
  const { areaId } = useParams();
  const [params, setParams] = useSearchParams();
  const buildingId = params.get('building');
  const recordId = params.get('record');
  const [q, setQ] = useState('');
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [tick, setTick] = useState(0);
  const map = usePublicMap(areaId);
  const building = usePublicBuilding(buildingId).data ?? null;
  const search = usePublicSearch(q);
  const record = building?.records.find((r) => r.id === recordId) ?? null;
  const levelId = record ? building?.storeys.find((s) => s.label === record.level)?.id ?? null : params.get('level');

  const set = useCallback((patch: Record<string, string | null>) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) if (v === null) n.delete(k); else n.set(k, v);
    return n;
  }, { replace: true }), [setParams]);
  const onPick = useCallback((pick: Pick) => {
    if (pick.kind === 'space' && building?.records.some((r) => r.id === pick.id)) set({ record: pick.id, level: null });
    else if (pick.kind === 'building') set({ building: pick.id, record: null, level: null });
    else set({ building: null, record: null, level: null });
  }, [building, set]);

  if (map.isPending) return <div className={styles.mapFrame} />;
  if (!map.data) return <div className={styles.wrap}><EmptyState icon={Buildings} title="This area has no public map">It may not have released records yet.</EmptyState></div>;
  const picked = buildingId ? map.data.features.find((f) => f.id === buildingId) : null;

  return (
    <div className={styles.mapFrame}>
      <PublicScene className={styles.canvas} map={map.data} building={building} levelId={levelId} spaceId={record?.id ?? null} onPick={onPick} onReady={setEngine} onView={() => setTick((t) => (t + 1) % 1_000_000)}
        label={`3D map of ${map.data.area.name}, view only. The panel lists the released records.`} />
      <aside className={`ul-float ${styles.mapPanel}`} aria-label="Released records">
        <label className={styles.mapSearch}>
          <Icon icon={MagnifyingGlass} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this map" aria-label="Search released records" />
        </label>
        {q.trim() ? (
          <ul className={styles.mapList}>
            {(search.data?.items ?? []).map((r) => (
              <li key={r.id}><button type="button" onClick={() => { set({ building: r.buildingId, record: r.id, level: null }); setQ(''); }}>
                <span>{r.name}, {r.buildingName}</span><span className="ul-caption">{r.level}</span></button></li>
            ))}
            {search.data && !search.data.items.length ? <li className={styles.mapEmpty}>No released record matches.</li> : null}
          </ul>
        ) : picked ? (
          <div className={styles.mapBody}>
            <span className="portal-h3">{picked.name}</span>
            {building ? (
              <>
                <span className="portal-body-sm ul-muted">{[building.address, building.parcelUlpin ? `Parcel ${building.parcelUlpin}` : null].filter(Boolean).join(' · ')}</span>
                {record ? (
                  <div className={styles.mapRecord}>
                    <span className={styles.resultHead}><b>{record.name}</b><StatusBadge status={record.status === 'assigned' ? 'Assigned' : 'Recorded'} /></span>
                    <span className="portal-body-sm ul-muted">{record.level}{record.carpetAreaM2 !== null ? ` · carpet area ${record.carpetAreaM2.toFixed(2)} m²` : ''}</span>
                    <Link to={`/portal/records/${record.id}`} className={styles.open}>Open record <Icon icon={ArrowRight} size={16} /></Link>
                    <button type="button" className="ul-btn ul-btn--ghost" onClick={() => set({ record: null })}>All records in this building</button>
                  </div>
                ) : (
                  <>
                    <span className="portal-label ul-muted">{building.records.length} released · {building.notReleased} not released yet</span>
                    <ul className={styles.mapList}>
                      {building.records.map((r) => (
                        <li key={r.id}><button type="button" onClick={() => set({ record: r.id })}><span>{r.name}</span><span className="ul-caption">{r.level}</span></button></li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : <span className="portal-body-sm ul-muted">No records of this building are released.</span>}
          </div>
        ) : (
          <div className={styles.mapBody}>
            <span className="portal-h3">{map.data.area.name}</span>
            <span className="portal-body-sm ul-muted">Select a building to see its released records.</span>
            <ul className={styles.mapList}>
              {map.data.released.map((r) => {
                const f = map.data!.features.find((x) => x.id === r.buildingId);
                return <li key={r.buildingId}><button type="button" onClick={() => set({ building: r.buildingId })}><span>{f?.name ?? 'Building'}</span><span className="ul-caption">{r.records} released</span></button></li>;
              })}
            </ul>
          </div>
        )}
      </aside>
      {building && !record ? (
        <div className={styles.mapRail}>
          <LevelRail levels={building.storeys.map((s) => ({ id: s.id, label: s.label, lower: s.lowerM, estimated: s.estimated, belowGround: s.belowGround }))}
            reference={building.datum} ground={building.groundM} selected={levelId} onSelect={(id) => set({ level: id === levelId ? null : id })} />
        </div>
      ) : null}
      {!buildingId && engine ? <ReleasedLabels engine={engine} tick={tick} items={map.data.released.map((r) => ({
        id: r.buildingId, text: `${map.data!.features.find((f) => f.id === r.buildingId)?.name ?? 'Building'} · ${r.records} released`,
        onSelect: () => set({ building: r.buildingId }),
      }))} /> : null}
      <span className={styles.viewOnlyMap}>View only</span>
    </div>
  );
}

/** Names the buildings that have released records, anchored above them. */
function ReleasedLabels({ engine, tick, items }: { engine: SceneEngine; tick: number; items: { id: string; text: string; onSelect: () => void }[] }) {
  void tick;
  return (
    <>
      {items.map((item) => {
        const at = engine.project(item.id);
        if (!at?.visible) return null;
        return (
          <button key={item.id} type="button" className={styles.mapLabel} onClick={item.onSelect}
            style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -130%)` }}>{item.text}</button>
        );
      })}
    </>
  );
}
