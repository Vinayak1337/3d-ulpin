import { Link } from 'react-router';
import { FileArrowUp } from '@phosphor-icons/react';
import type { BuildingLedger } from '@ulpin/api-client/draft';
import { Button, DescriptionList, EvidenceChip, FindingCard, Icon, StatusBadge, formatCount } from '@ulpin/ui';
import type { BuildingRegister } from '../../../api/queries';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { parseLocator } from '../../evidence/refs';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

/**
 * Findings mode: the open finding as a reproducible card (severity, result, arithmetic, sources, actions).
 * With no checks run, the mode says Not assessed with the reason, never "no conflict".
 */
export function FindingsInspector({ register, ledger, findingId, buildingId, crumbs, onOpenSpace }: {
  register: BuildingRegister | undefined; ledger: BuildingLedger | null | undefined; findingId: string | null; buildingId: string;
  crumbs: Crumb[]; onOpenSpace: (spaceId: string) => void;
}) {
  const openEvidence = useOpenEvidence();
  const findings = register?.findings ?? [];
  const finding = findings.find((f) => f.id === findingId) ?? findings[0];
  if (!finding) {
    const qualification = register?.geometryQualification;
    return (
      <InspectorShell rekey="findings" crumbs={crumbs} title="Findings" status={<StatusBadge status="Not assessed" />}>
        <DescriptionList items={[
          { label: 'Checks', value: <StatusBadge status="Not assessed" /> },
          { label: 'Geometry', value: qualification ? `${qualification.state.replace('_', ' ')} · ${qualification.purpose.replace(/_/g, ' ')}` : <span className="ul-unknown">Unknown</span> },
          { label: 'Open findings', value: formatCount(0) },
        ]} />
        <p className={styles.note}>Overlap, void and share checks need qualified 3D geometry for every space. This record has none yet, so nothing was checked. This is not a pass.</p>
      </InspectorShell>
    );
  }
  const detail = ledger?.findingDetails.find((d) => d.findingId === finding.id);
  const spaceParticipant = finding.featureIds.find((id) => register?.register.some((r) => r.id === id && r.kind === 'space'));
  const action = (label: string) => {
    if (label === 'Request evidence') return <Link key={label} to={`/studio/add-files?feature=${buildingId}`} className="ul-btn"><Icon icon={FileArrowUp} />{label}</Link>;
    if (label === 'Review area' && spaceParticipant) return <Button key={label} variant="primary" onClick={() => onOpenSpace(spaceParticipant)}>{label}</Button>;
    const evidence = detail?.evidence.find((e) => e.sourceId);
    if (label === 'Apply level evidence' && evidence?.sourceId) {
      return <Button key={label} variant="primary" onClick={() => openEvidence({ sourceId: evidence.sourceId!, label: evidence.source ?? 'Source', locator: parseLocator({ locator: evidence.locator ?? undefined }) })}>{label}</Button>;
    }
    return null;
  };
  return (
    <div className={styles.findingWrap} key={finding.id}>
      <FindingCard
        severity={finding.category === 'blocking' ? 'blocking' : finding.category === 'needs_review' ? 'needs-review' : 'not-assessed'}
        method={`${finding.method ?? ledger?.checkMethod ?? 'Check'} · r${register?.property.revision ?? 1}`}
        title={finding.message}
        calculation={detail?.calculation}
        evidence={detail?.evidence.length ? detail.evidence.map((e, i) => (
          <EvidenceChip key={i} kind={e.kind ?? 'document'} state={e.state ?? 'linked'} source={e.source ?? 'Needs evidence'} locator={e.locator ?? undefined}
            onOpen={e.sourceId ? () => openEvidence({ sourceId: e.sourceId!, label: e.source ?? 'Source', locator: parseLocator({ locator: e.locator ?? undefined }) }) : undefined} />
        )) : undefined}
        actions={detail?.actions.length ? <>{detail.actions.map(action)}</> : undefined}
      />
      {finding.limitations?.length ? <ul className={styles.gaps}>{finding.limitations.map((l) => <li key={l}>{l}</li>)}</ul> : null}
    </div>
  );
}
