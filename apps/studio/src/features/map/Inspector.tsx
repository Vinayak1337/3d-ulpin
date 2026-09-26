import { Link } from 'react-router';
import { ArrowLeft, Copy, FilePlus, FileText, Buildings } from '@phosphor-icons/react';
import { Button, Icon, StatusBadge, formatCount, formatDate, formatMeasure } from '@ulpin/ui';
import type { AreaContext, AreaFeature } from '../../api/queries';
import styles from './Inspector.module.css';

/** GOAL override 4: one inspector; its content depends on the selection. */
export function Inspector({ area, feature, buildings, onSelect }: {
  area: AreaContext['area']; feature: AreaFeature | null; buildings: AreaFeature[]; onSelect: (id: string | null) => void;
}) {
  return (
    <aside className={styles.inspector} aria-label="Inspector">
      {feature ? <FeatureView feature={feature} onBack={() => onSelect(null)} /> : <AreaView area={area} buildings={buildings} onSelect={onSelect} />}
    </aside>
  );
}

function AreaView({ area, buildings, onSelect }: { area: AreaContext['area']; buildings: AreaFeature[]; onSelect: (id: string) => void }) {
  return (
    <>
      <header className={styles.head}>
        <p className={styles.crumb}>Area</p>
        <h1 className="ul-heading">{area.name}</h1>
      </header>
      <div className={styles.body}>
        <p className={styles.hint}>Select a building on the map or in the list.</p>
        <h2 className={styles.listTitle}>Buildings <span className="ul-num">{formatCount(buildings.length)}</span></h2>
        {buildings.length ? (
          <ul className={styles.list}>
            {buildings.map((building) => (
              <li key={building.id}>
                <button type="button" onClick={() => onSelect(building.id)}>
                  <Icon icon={Buildings} size={16} />
                  <span className={styles.listName}>{building.name}</span>
                  <span className={styles.listMeta}>{heightText(building, 1)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>This area has no buildings recorded yet.</p>
        )}
      </div>
    </>
  );
}

function FeatureView({ feature, onBack }: { feature: AreaFeature; onBack: () => void }) {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const semantics = feature.semantics ?? {};
  const pointer = feature.evidence[0]?.jsonPointer;
  return (
    <>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={onBack}>
          <Icon icon={ArrowLeft} size={16} />
          Area
        </button>
        <h1 className="ul-heading">{feature.name}</h1>
        <p className={styles.idRow}>
          <span className="ul-id">{feature.identifier}</span>
          <Button variant="ghost" iconOnly icon={Copy} aria-label={`Copy ${feature.identifier}`} onClick={() => void navigator.clipboard?.writeText(feature.identifier)} />
        </p>
      </header>
      <div className={styles.body}>
        <dl className="ul-dl">
          <dt>Height</dt>
          <dd>
            {feature.height.state === 'unknown' || feature.height.value === null || feature.height.value === undefined
              ? <StatusBadge status="Unknown" />
              : <span className="ul-num">{heightText(feature, 2)}</span>}
            {feature.height.evidence?.length ? (
              <EvidenceChip label="Roof height" detail={feature.height.originalValue !== undefined ? `${String(feature.height.originalValue)} ${feature.height.originalUnit ?? ''}`.trim() : feature.height.evidence[0]?.jsonPointer} />
            ) : null}
          </dd>
          {feature.height.reference ? (<><dt>Measured from</dt><dd>{feature.height.reference}</dd></>) : null}
          <dt>Footprint area</dt>
          <dd><span className="ul-num">{formatMeasure(feature.areaM2, 'm²')}</span> <span className={styles.note}>calculated from the footprint</span></dd>
          <dt>World status</dt>
          <dd>{worldStatusText(feature.worldStatus)}</dd>
          {typeof semantics.sourceDate === 'string' ? (<><dt>Source edited</dt><dd>{formatDate(semantics.sourceDate)}</dd></>) : null}
          {typeof props.geom_source === 'string' ? (<><dt>Captured by</dt><dd>{props.geom_source}</dd></>) : null}
          <dt>Parcel ULPIN</dt>
          <dd className={styles.note}>Official parcel anchor not supplied</dd>
        </dl>

        <h2 className={styles.sectionTitle}>Source identifiers</h2>
        <dl className="ul-dl">
          {Object.entries(SOURCE_IDS).map(([key, label]) =>
            typeof props[key] === 'string' ? (
              <div key={key} className={styles.pair}><dt>{label}</dt><dd className="ul-id">{props[key] as string}</dd></div>
            ) : null)}
        </dl>

        <h2 className={styles.sectionTitle}>Evidence</h2>
        <p className={styles.evidenceRow}>
          <EvidenceChip label={feature.datasetNamespace} detail={pointer ? `feature ${feature.sourceKey}` : undefined} />
        </p>
        <p className={styles.note}>Geometry and height are from the source. They do not establish ownership, floors or rights.</p>
      </div>
      <footer className={styles.foot}>
        <Link to={`/studio/add-files?feature=${feature.id}`} className="ul-btn ul-btn--primary">
          <Icon icon={FilePlus} />
          Add files
        </Link>
      </footer>
    </>
  );
}

/** Evidence chip: the evidence viewer (S7, milestone M4) opens from here. */
function EvidenceChip({ label, detail }: { label: string; detail?: string }) {
  return (
    <span className="ul-evid" title={detail ? `${label}: ${detail}` : label}>
      <Icon icon={FileText} size={16} />
      <b>{label}</b>
      {detail ? <span>{detail}</span> : null}
    </span>
  );
}

const SOURCE_IDS: Record<string, string> = {
  doitt_id: 'DOITT ID',
  bin: 'Building number (BIN)',
  base_bbl: 'Tax lot (BBL)',
};

function heightText(feature: AreaFeature, digits: 1 | 2): string {
  const { value, state } = feature.height;
  if (state === 'unknown' || value === null || value === undefined) return 'Height unknown';
  return `${formatMeasure(value, 'm', digits)}${state === 'estimated' ? ' est.' : ''}`;
}

function worldStatusText(status: AreaFeature['worldStatus']): string {
  return { observed: 'Observed', planned: 'Planned', hypothetical: 'Hypothetical', synthetic: 'Synthetic' }[status];
}
