import { useState } from 'react';
import { Link } from 'react-router';
import { FilePlus, Stack } from '@phosphor-icons/react';
import { Button, DescriptionList, EvidenceChip, Icon, Skeleton, StatusBadge, Tabs, formatCount, formatDate, formatMeasure, type Fact } from '@ulpin/ui';
import type { AreaFeature, BuildingRegister } from '../../../api/queries';
import type { BuildingModel } from '../../../model/building';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { featureEvidence } from './evidence';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

type Tab = 'overview' | 'evidence';

/** Building variant: facts with inline evidence; Explore floors when levels exist, else Add files. */
export function BuildingInspector({ feature, register, model, registerPending, crumbs, onExplore, onFindings }: {
  feature: AreaFeature; register: BuildingRegister | undefined; model: BuildingModel | null; registerPending: boolean;
  crumbs: Crumb[]; onExplore: () => void; onFindings: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const openEvidence = useOpenEvidence();
  const evidence = featureEvidence(feature);
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const levels = model?.levels ?? [];
  const spaces = model?.spaces.filter((s) => !s.parentId) ?? [];
  const known = feature.height.value !== null && feature.height.value !== undefined && feature.height.state !== 'unknown';

  const facts: Fact[] = [
    {
      label: 'Height',
      value: (
        <span className="ul-row">
          {known ? <span className="ul-num">{formatMeasure(feature.height.value, 'm', 2)}</span> : <StatusBadge status="Unknown" />}
          {evidence.height.map((ref) => (
            <EvidenceChip key={ref.locator.text} kind="feature" source={ref.label}
              locator={feature.height.originalValue !== undefined ? `${String(feature.height.originalValue)} ${feature.height.originalUnit ?? ''}`.trim() : ref.locator.text}
              onOpen={() => openEvidence(ref)} />
          ))}
        </span>
      ),
    },
    { label: 'Measured from', value: feature.height.reference || <span className="ul-unknown">Not stated</span> },
    { label: 'Levels', value: registerPending ? <Skeleton width={80} /> : levels.length ? `${formatCount(levels.length)} recorded` : <span className="ul-unknown">None recorded</span> },
    { label: 'Spaces', value: registerPending ? <Skeleton width={80} /> : spaces.length ? formatCount(spaces.length) : <span className="ul-unknown">None recorded</span> },
    { label: 'Footprint area', value: feature.areaM2 === null || feature.areaM2 === undefined ? <span className="ul-unknown">Not assessed</span> : <span className="ul-num">{formatMeasure(feature.areaM2, 'm²')}</span> },
    {
      label: 'Findings',
      value: register?.findings.length
        ? <button type="button" className="ul-badge ul-badge--danger" onClick={onFindings}>{formatCount(register.findings.length)} open</button>
        : <button type="button" className="ul-badge" onClick={onFindings} title="Open findings mode">Not assessed</button>,
    },
    { label: 'Parcel ULPIN', value: register?.parcelIdentifiers.length ? register.parcelIdentifiers.map((p) => p.value).join(', ') : <span className="ul-unknown">Official parcel anchor not supplied</span> },
  ];
  if (typeof props.geom_source === 'string') facts.push({ label: 'Captured by', value: props.geom_source });
  const sourceDate = feature.semantics?.sourceDate;
  if (typeof sourceDate === 'string') facts.push({ label: 'Source edited', value: formatDate(sourceDate) });

  const canExplore = levels.length > 0;
  return (
    <InspectorShell
      rekey={feature.id}
      crumbs={crumbs}
      title={feature.name}
      subtitle={<span className="ul-mono">{feature.identifier}</span>}
      tabs={<Tabs label="Building details" value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'evidence', label: 'Evidence', count: (register?.sources.length ?? 0) || undefined }]} />}
      actions={(
        <>
          {canExplore
            ? <Button variant="primary" icon={Stack} onClick={onExplore}>Explore floors</Button>
            : <Link to={`/studio/add-files?feature=${feature.id}`} className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}
          <Link to={`/studio/properties/${feature.id}/register`} className="ul-btn">Open register</Link>
        </>
      )}
      blocked={!registerPending && !canExplore ? 'no floors recorded for this building. Add a plan or level schedule.' : null}
    >
      {tab === 'overview' ? (
        <>
          <DescriptionList items={facts} />
          <p className={styles.note}>Geometry and height come from the source. They do not establish ownership, floors or rights.</p>
        </>
      ) : (
        <>
          <h3 className={styles.sectionTitle}>Sources</h3>
          <div className={styles.chips}>
            {evidence.geometry.map((ref) => <EvidenceChip key={ref.sourceId + ref.locator.text} kind="feature" source={ref.label} locator={ref.locator.text} onOpen={() => openEvidence(ref)} />)}
          </div>
          {register?.missing.length ? (
            <>
              <h3 className={styles.sectionTitle}>What the sources do not say</h3>
              <ul className={styles.gaps}>{register.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </>
          ) : null}
        </>
      )}
    </InspectorShell>
  );
}
