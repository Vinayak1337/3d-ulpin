import { Link, useParams } from 'react-router';
import { DownloadSimple, WarningCircle } from '@phosphor-icons/react';
import { Button, DescriptionList, EmptyState, PropertyCard, Skeleton, StrataSection, UlpinCode, formatDate } from '@ulpin/ui';
import { Qr } from '../features/identity/Qr';
import { shortHash } from '../local/workflow';
import { Crumbs } from './PortalFrame';
import { PublicScene } from './PublicScene';
import { usePublicBuilding, usePublicMap, usePublicRecord } from './queries';
import styles from './Portal.module.css';

/** P3: one released record: its code, released facts, a view-only 3D view and its place in the building's section. */
export function RecordPage() {
  const { recordId } = useParams();
  const record = usePublicRecord(recordId);
  const r = record.data;
  const building = usePublicBuilding(r?.buildingId).data ?? null;
  const map = usePublicMap(building?.areaId).data ?? null;
  if (record.isPending) return <div className={styles.wrap}><Skeleton width="50%" height={36} /><Skeleton height={320} /></div>;
  if (!r) {
    return (
      <div className={styles.wrap}>
        <EmptyState icon={WarningCircle} title="This record is not released" action={<Link to="/portal">Search again</Link>}>
          {record.error?.message ?? 'Only recorded units are public. This one may still be under review.'}
        </EmptyState>
      </div>
    );
  }
  const title = `${r.name}, ${r.buildingName}`;
  const verify = r.code ? `${window.location.origin}/verify/${encodeURIComponent(r.code)}?rev=${r.revision}` : null;
  const facts = [
    { label: 'Level', value: r.level ?? <span className="ul-unknown">Unknown</span> },
    { label: 'Elevations', value: r.lowerM !== null && r.upperM !== null ? `${r.lowerM.toFixed(1)} to ${r.upperM.toFixed(1)} m${r.datum ? ` · site datum ${r.datum}` : ''}` : <span className="ul-unknown">Unknown</span> },
    { label: 'Carpet area', value: r.carpetAreaM2 !== null ? `${r.carpetAreaM2.toFixed(2)} m²` : <span className="ul-unknown">Unknown</span> },
    { label: 'Undivided share', value: r.sharePct !== null ? `${r.sharePct.toFixed(2)} %` : <span className="ul-unknown">Unknown</span> },
    { label: 'Shared spaces', value: r.sharedSpaces.length ? r.sharedSpaces.join(', ') : <span className="ul-muted">None on this level</span> },
    { label: 'Last updated', value: `${formatDate(r.updatedAt)} · r${r.revision}` },
  ];
  return (
    <div className={styles.wrap}>
      <div className={styles.recordHead}>
        <Crumbs items={[{ label: 'Home', to: '/portal' }, { label: r.buildingName, to: `/portal/buildings/${r.buildingId}` }, { label: r.name }]} />
        <h1 className="portal-h1">{title}</h1>
        {r.code ? <UlpinCode code={r.code} location={r.location} /> : <span className="portal-body ul-muted">3D ULPIN (proposed): not assigned yet</span>}
        {r.parcelUlpin ? <span className="portal-body-sm ul-muted">Parcel ULPIN <span className="ul-mono">{r.parcelUlpin}</span></span> : null}
      </div>
      <div className={styles.note}>Released details only. Owner names and documents are not public.</div>
      <div className={styles.split}>
        <div className={styles.stack}>
          <div className={styles.sceneBox}>
            {map && building ? <PublicScene className={styles.canvas} map={map} building={building} levelId={r.levelId} spaceId={r.id} label={`${r.name} on ${r.level}, view only`} /> : null}
            <span className={styles.viewOnly}>View only</span>
          </div>
          {building ? (
            <StrataSection parcel={building.parcelUlpin} ground={building.groundM} datum={building.datum} selectedId={r.levelId} selectedLabel={`${r.level} · ${r.name}`}
              levels={building.storeys.map((s) => ({ id: s.id, label: s.label, lower: s.lowerM, upper: s.upperM, estimated: s.estimated }))} />
          ) : null}
        </div>
        <div className={styles.factsCard}>
          <DescriptionList items={facts} />
          {r.code && verify ? (
            <Button variant="primary" icon={DownloadSimple} onClick={() => window.print()}>Download Property Card</Button>
          ) : <p className="portal-body-sm ul-muted">A Property Card is issued once a proposed 3D ULPIN is assigned to this unit.</p>}
          <p className="portal-body-sm ul-muted">Something wrong? <Link to={`/portal/request?building=${r.buildingId}&record=${r.id}&kind=correction`}>Request a correction</Link> with your deed or plan.</p>
        </div>
      </div>
      {r.code && verify ? (
        <div className={styles.printOnly} aria-hidden="true">
          <PropertyCard title={title} code={r.code} location={r.location} revision={`r${r.revision}`} hash={shortHash(r.revisionHash)} chain="Chain consistent"
            qr={<Qr value={verify} size={88} label="QR code: verification page" />} facts={facts.slice(0, 4)} />
        </div>
      ) : null}
    </div>
  );
}
