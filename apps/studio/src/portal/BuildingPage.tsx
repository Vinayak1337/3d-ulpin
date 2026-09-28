import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, Buildings } from '@phosphor-icons/react';
import { DescriptionList, EmptyState, Icon, Skeleton, StatusBadge, StrataSection, UlpinCode, formatMeasure } from '@ulpin/ui';
import { Crumbs } from './PortalFrame';
import { PublicScene } from './PublicScene';
import { usePublicBuilding, usePublicMap } from './queries';
import styles from './Portal.module.css';

/**
 * A building by its 3D ULPIN: its public identity, a view-only 3D view, its released records, and a way to
 * request its register (when no floors are recorded yet), new floor data, a correction, a change of holder or a copy.
 */
export function BuildingPage() {
  const { buildingId } = useParams();
  const query = usePublicBuilding(buildingId);
  const [allRecords, setAllRecords] = useState(false);
  const b = query.data;
  const map = usePublicMap(b?.areaId).data ?? null;
  if (query.isPending) return <div className={styles.wrap}><Skeleton width="50%" height={36} /><Skeleton height={320} /></div>;
  if (!b) {
    return (
      <div className={styles.wrap}>
        <EmptyState icon={Buildings} title="This building is not on record" action={<Link to="/portal">Search again</Link>}>
          It may have been removed, or the link is incomplete.
        </EmptyState>
      </div>
    );
  }
  const levels = b.storeys.length;
  const facts = [
    { label: 'Area', value: b.areaName },
    { label: 'Parcel ULPIN', value: b.parcelUlpin ? <span className="ul-mono">{b.parcelUlpin}</span> : <span className="ul-unknown">Unknown</span> },
    ...(b.address ? [{ label: 'Address', value: b.address }] : []),
    { label: 'Height', value: b.heightM !== null ? formatMeasure(b.heightM, 'm', 1) : <span className="ul-unknown">Unknown</span> },
    { label: 'Floors recorded', value: levels ? `${levels} levels` : <span className="ul-muted">Not recorded yet</span> },
    { label: 'Released records', value: levels ? `${b.records.length} released · ${b.notReleased} not released yet` : <span className="ul-muted">None</span> },
  ];
  const request = `/portal/request?building=${b.id}`;
  return (
    <div className={styles.wrap}>
      <div className={styles.recordHead}>
        <Crumbs items={[{ label: 'Home', to: '/portal' }, { label: 'Map', to: `/portal/map/${b.areaId}?building=${b.id}` }, { label: b.name }]} />
        <h1 className="portal-h1">{b.name}</h1>
        <UlpinCode code={b.code} location={b.location} />
      </div>
      <div className={styles.split}>
        <div className={styles.stack}>
          <div className={styles.sceneBox}>
            {map ? <PublicScene className={styles.canvas} map={map} building={b} levelId={null} spaceId={null} label={`3D view of ${b.name}, view only`} /> : null}
            <span className={styles.viewOnly}>View only · illustrative look</span>
          </div>
          {levels ? (
            <StrataSection parcel={b.parcelUlpin} ground={b.groundM} datum={b.datum} selectedId={null}
              levels={b.storeys.map((s) => ({ id: s.id, label: s.label, lower: s.lowerM, upper: s.upperM, estimated: s.estimated }))} />
          ) : null}
        </div>
        <div className={styles.buildingFacts}>
          <div className={styles.factsCard}><DescriptionList items={facts} /></div>
          {b.records.length ? (
            <div className="ul-stack">
              <span className="portal-label ul-muted">Released records</span>
              <ul className={styles.recordList}>
                {(allRecords ? b.records : b.records.slice(0, 8)).map((r) => (
                  <li key={r.id}>
                    <Link to={`/portal/records/${r.id}`}>
                      <span>{r.name} <span className="ul-muted">· {r.level}</span></span>
                      <StatusBadge status={r.status === 'assigned' ? 'Assigned' : 'Recorded'} />
                    </Link>
                  </li>
                ))}
              </ul>
              {b.records.length > 8 && !allRecords ? (
                <button type="button" className="ul-btn ul-btn--ghost" style={{ justifySelf: 'start' }} onClick={() => setAllRecords(true)}>Show all {b.records.length} records</button>
              ) : null}
            </div>
          ) : null}
          {levels ? (
            <div className={styles.cta}>
              <span className="portal-h3">Update this building's record</span>
              <p className="portal-body-sm ul-muted">Send new floor data, report a wrong value, register a change of holder or tenant, or ask for a certified copy. Attach your deed or plan.</p>
              <div className="ul-row" style={{ flexWrap: 'wrap' }}>
                <Link to={`${request}&kind=floors`} className="ul-btn ul-btn--primary">Add or update floor data <Icon icon={ArrowRight} size={16} /></Link>
                <Link to={`${request}&kind=correction`} className="ul-btn">Request a correction</Link>
                <Link to={`${request}&kind=residents`} className="ul-btn">Change of holder or residents</Link>
                <Link to={`${request}&kind=copy`} className="ul-btn">Certified copy</Link>
              </div>
            </div>
          ) : (
            <div className={styles.cta}>
              <span className="portal-h3">Floors and flats of this building are not recorded yet</span>
              <p className="portal-body-sm ul-muted">Owners, tenants and resident associations can request its register. Attach the building's plans, level schedule or deeds if you have them.</p>
              <Link to={`${request}&kind=register`} className="ul-btn ul-btn--primary">Request this building's register <Icon icon={ArrowRight} size={16} /></Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
