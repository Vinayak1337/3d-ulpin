import { useState } from 'react';
import { Link } from 'react-router';
import { CircleDashed, FilePlus, Stack, Trash, WarningOctagon } from '@phosphor-icons/react';
import type { NormalizedBuilding } from '@ulpin/contracts/canonical-scene';
import type { BuildingLedger } from '@ulpin/api-client/draft';
import {
  Badge, Button, DescriptionList, EvidenceChip, Icon, ReadinessMeter, RevisionTimeline, Skeleton, StatusBadge, Tabs, formatCount, formatDate,
  UlpinCode, formatMeasure, type Fact,
} from '@ulpin/ui';
import { featureCode, type AreaFeature, type BuildingRegister } from '../../../api/queries';
import type { BuildingModel } from '../../../model/building';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { parseLocator } from '../../evidence/refs';
import { CheckBadge } from '../CheckBadge';
import { RIGHTS_LABEL, RIGHTS_TOKEN, ledgerStatus, revisionChain, revisionKey } from '../ledger';
import { featureEvidence } from './evidence';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

type Tab = 'overview' | 'rights' | 'evidence' | 'checks' | 'history';

/** "G + 8 · stilt · B1, B2" from the recorded levels. */
export function levelSummary(model: BuildingModel): string {
  const above = model.levels.filter((l) => !l.belowGround && l.label.toLowerCase() !== 'roof');
  const ground = above.find((l) => /^g/i.test(l.label));
  const upper = above.filter((l) => l !== ground).length;
  const below = model.levels.filter((l) => l.belowGround).map((l) => l.label);
  const parts = [ground ? `G + ${upper}` : `${upper} floors`];
  if (ground?.record.use?.toLowerCase().includes('stilt')) parts.push('stilt');
  if (below.length) parts.push(below.join(', '));
  return parts.join(' · ');
}

/** The record's state as the canonical record states it: a candidate proposal or a reviewed record. */
function RecordState({ state }: { state: NormalizedBuilding['recordState'] }) {
  if (state === 'reviewed') return <StatusBadge status="Reviewed" />;
  return <Badge icon={CircleDashed}>Candidate</Badge>;
}

export function BuildingInspector({ feature, canonical, register, model, ledger, registerPending, crumbs, exploring, onExplore, onFindings, onAddFiles, onDelete }: {
  feature: AreaFeature; canonical: NormalizedBuilding | undefined; register: BuildingRegister | undefined; model: BuildingModel | null; ledger: BuildingLedger | null | undefined;
  registerPending: boolean; crumbs: Crumb[]; exploring: boolean; onExplore: () => void; onFindings: (findingId?: string) => void; onAddFiles?: () => void; onDelete?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const openEvidence = useOpenEvidence();
  const evidence = featureEvidence(feature);
  const levels = model?.levels ?? [];
  const units = model?.spaces.filter((s) => s.use === 'apartment').length ?? 0;
  const findings = register?.findings ?? [];
  const blocking = findings.filter((f) => f.category === 'blocking').length;
  const status = ledgerStatus(ledger?.status);
  const parcel = ledger?.parcelUlpin ?? register?.parcelIdentifiers[0]?.value ?? null;
  const known = feature.height.value !== null && feature.height.value !== undefined && feature.height.state !== 'unknown';
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const address = ledger?.address ?? (typeof props.address === 'string' ? props.address : null);

  const facts: Fact[] = [];
  if (address) facts.push({ label: 'Address', value: address });
  facts.push({ label: 'Levels', value: registerPending ? <Skeleton width={120} /> : levels.length ? levelSummary(model!) : <span className="ul-unknown">None recorded</span> });
  if (units || registerPending) facts.push({ label: 'Units', value: registerPending ? <Skeleton width={40} /> : <span className="ul-num">{formatCount(units)}</span> });
  facts.push({
    label: 'Height',
    value: (
      <span className="ul-row">
        {known ? <span className="ul-num">{formatMeasure(feature.height.value, 'm', 1)}</span> : <StatusBadge status="Unknown" />}
        {evidence.height.slice(0, 1).map((ref) => (
          <EvidenceChip key={ref.locator.text} kind="feature" source={feature.height.originalValue !== undefined ? 'Roof height' : ref.label}
            locator={feature.height.originalValue !== undefined ? sourceValue(feature.height.originalValue, feature.height.originalUnit, 2) : ref.locator.text}
            exact={feature.height.originalValue !== undefined ? sourceValue(feature.height.originalValue, feature.height.originalUnit) : undefined}
            onOpen={() => openEvidence(ref)} />
        ))}
      </span>
    ),
  });
  facts.push({
    label: 'Findings',
    value: findings.length
      ? <button type="button" className={`ul-badge ${blocking ? 'ul-badge--danger' : 'ul-badge--warning'}`} onClick={() => onFindings()}><Icon icon={WarningOctagon} size={16} />{blocking ? `${blocking} blocking` : `${findings.length} to review`}</button>
      : <button type="button" className="ul-badge" onClick={() => onFindings()} title="Open findings mode">Not assessed</button>,
  });
  if (ledger && !ledger.readiness.dimensions.length) facts.push({ label: 'Readiness', value: <StatusBadge status="Not assessed" /> });
  if (typeof props.geom_source === 'string') facts.push({ label: 'Captured by', value: props.geom_source });
  if (typeof feature.semantics?.sourceDate === 'string') facts.push({ label: 'Source edited', value: formatDate(feature.semantics.sourceDate) });

  const tabs: { value: Tab; label: string; count?: number }[] = [{ value: 'overview', label: 'Overview' }];
  if (ledger) tabs.push({ value: 'rights', label: 'Rights' });
  tabs.push({ value: 'evidence', label: 'Evidence' });
  if (ledger) tabs.push({ value: 'checks', label: 'Checks' }, { value: 'history', label: 'History' });

  const canExplore = levels.length > 0;
  return (
    <InspectorShell
      rekey={feature.id}
      crumbs={crumbs}
      title={feature.name}
      status={canonical ? <RecordState state={canonical.recordState} /> : status ? <StatusBadge status={status} /> : undefined}
      subtitle={<span className="ul-mono">{parcel ? <>Parcel ULPIN · {parcel}</> : feature.identifier}</span>}
      tabs={<Tabs label="Building details" value={tab} onChange={setTab} tabs={tabs} />}
      actions={(
        <>
          {canExplore
            ? <Button variant="primary" icon={Stack} disabled={exploring} onClick={onExplore}>{exploring ? 'Select a unit' : 'Explore floors'}</Button>
            : onAddFiles ? <Button variant="primary" icon={FilePlus} onClick={onAddFiles}>Add files</Button>
              : <Link to={`/studio/add-files?feature=${feature.id}`} className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}
          <Link to={`/studio/properties/${feature.id}/register`} className="ul-btn">Open register</Link>
        </>
      )}
      blocked={!registerPending && !canExplore ? 'no floors recorded for this building. Add a plan or level schedule.' : null}
    >
      {tab === 'overview' ? (
        <>
          {featureCode(feature) ? <UlpinCode code={featureCode(feature)} location={feature.identifier ? feature.identifier.split('/') : null} /> : null}
          <DescriptionList items={facts} />
          {ledger?.readiness.dimensions.length ? (
            <ReadinessMeter task={ledger.readiness.task} dimensions={ledger.readiness.dimensions.map((d) => ({ name: d.name, value: d.value ?? 'unknown', label: d.label }))} />
          ) : <p className={styles.note}>Geometry and height come from the source. They do not establish ownership, floors or rights.</p>}
          {canonical?.gaps.length ? <ul className={styles.gaps} aria-label="Gaps in this record">{canonical.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}
          {onDelete ? <Button variant="ghost" icon={Trash} className={styles.delete} onClick={onDelete} aria-label={`Delete ${feature.name}`}>Delete building</Button> : null}
        </>
      ) : tab === 'rights' && ledger ? (
        <RightsSummary ledger={ledger} />
      ) : tab === 'evidence' ? (
        <div className={styles.chips}>
          {ledger
            ? ledger.sources.map((s) => <EvidenceChip key={s.sourceId} kind={s.kind} source={s.name} locator={s.summary} onOpen={() => openEvidence({ sourceId: s.sourceId, label: s.name, locator: parseLocator({ locator: s.summary }) })} />)
            : evidence.geometry.map((ref) => <EvidenceChip key={ref.sourceId + ref.locator.text} kind="feature" source={ref.label} locator={ref.locator.text} onOpen={() => openEvidence(ref)} />)}
          {register?.missing.length ? <ul className={styles.gaps}>{register.missing.map((m) => <li key={m}>{m}</li>)}</ul> : null}
        </div>
      ) : tab === 'checks' && ledger ? (
        ledger.checks.length === 0 ? <p className={styles.note}>{ledger.checkMethod}</p> : <ul className={styles.list}>
          {ledger.checks.map((c) => (
            <li key={c.name}>
              <button type="button" disabled={!c.findingId} onClick={() => c.findingId && onFindings(c.findingId)}>
                <span className={styles.checkText}><b>{c.name}</b>{c.detail ? <span className="ul-muted">{c.detail}</span> : null}</span>
                <CheckBadge state={c.state} />
              </button>
            </li>
          ))}
        </ul>
      ) : ledger?.revisions.length === 0 ? (
        <p className={styles.note}>No history is recorded for this building.</p>
      ) : ledger ? (
        <RevisionTimeline chain={revisionChain(ledger.revisions)} revisions={ledger.revisions.map((r) => ({
          id: revisionKey(r), title: r.title, kind: r.kind, byline: `${r.actor ?? 'Unknown'} · ${formatDate(r.at)}`, hash: r.hash ? shortHash(r.hash) : null, previousHash: r.previousHash ? shortHash(r.previousHash) : null,
        }))} />
      ) : null}
    </InspectorShell>
  );
}

export const shortHash = (hash: string) => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

function RightsSummary({ ledger }: { ledger: BuildingLedger }) {
  const counts = new Map<string, number>();
  for (const s of ledger.spaces) counts.set(s.rights, (counts.get(s.rights) ?? 0) + 1);
  return (
    <>
      {ledger.spaces.length ? <div className={styles.rightsList}>
        {(['exclusive', 'shared', 'public', 'unknown'] as const).map((r) => (
          <span key={r} className={styles.rightsRow}>
            <span className={`ul-swatch${r === 'unknown' ? ' ul-hatch' : ''}`} style={{ backgroundColor: `var(${RIGHTS_TOKEN[r]})` }} />
            <span>{RIGHTS_LABEL[r]}</span>
            <span className="ul-num ul-muted">{counts.get(r) ?? 0}</span>
          </span>
        ))}
      </div> : null}
      <DescriptionList items={[
        { label: 'Declaration', value: ledger.declaration ?? <span className="ul-unknown">Unknown</span> },
        { label: 'Shares total', value: ledger.shareTotalPct === null ? <StatusBadge status="Unknown" /> : (
          <span className="ul-row"><span className="ul-num">{ledger.shareTotalPct.toFixed(2)} %</span>
            {ledger.shareEvidence ? <EvidenceChip source={ledger.shareEvidence.source} locator={ledger.shareEvidence.locator} /> : null}</span>
        ) },
        { label: 'Share basis', value: ledger.shareBasis ?? <span className="ul-unknown">Unknown</span> },
      ]} />
    </>
  );
}

/** A source value with its unit; rounded for display when `digits` is given (the exact value stays on hover). */
function sourceValue(value: unknown, unit: string | null | undefined, digits?: number): string {
  const n = Number(value);
  const text = digits !== undefined && typeof value !== 'boolean' && String(value).trim() !== '' && Number.isFinite(n)
    ? n.toLocaleString('en-IN', { maximumFractionDigits: digits })
    : String(value);
  return `${text} ${unit ?? ''}`.trim();
}
