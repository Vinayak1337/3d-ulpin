import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { DescriptionList } from '@ulpin/ui';
import type { IdentityReview, ListedCard } from '../../../api/queries';
import { AssignCodeDialog } from '../../identity/AssignCodeDialog';
import { CopyableId } from '../../identity/CopyableId';
import type { IssueTarget } from '../../identity/issue';
import { IssueCardDialog } from '../../identity/IssueCardDialog';
import { CitationControls } from './CitationControls';
import type { RecordedUnit } from './model';
import { UnitAssignment } from './UnitAssignment';
import { UnitCards } from './UnitCards';
import { ValueText } from './ValueText';
import styles from './Recorded.module.css';

const NO_CODE = <span>No code assigned</span>;

/** A dialog returns focus to its opener; when that action no longer exists, focus moves to the unit instead. */
function useFocusAfterClose(target: RefObject<HTMLElement | null>, open: boolean) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) target.current?.focus();
    wasOpen.current = open;
  }, [open, target]);
}

/** A link from elsewhere names the unit in the address: the unit is scrolled to and takes focus on arrival. */
function useArrival(target: RefObject<HTMLElement | null>, unitId: string) {
  useEffect(() => {
    if (window.location.hash !== `#unit-${unitId}`) return;
    target.current?.scrollIntoView();
    target.current?.focus();
  }, [target, unitId]);
}

/**
 * One unit recorded from a source label: its literal, what is unknown about it, its citation and its code.
 * A unit without a code offers its review and assignment; a unit with one lists its registry cards and offers
 * to issue one.
 */
export function RecordedUnitItem({ buildingId, floorLabel, unit }: {
  buildingId: string; floorLabel: string; unit: RecordedUnit;
}) {
  // null: closed. Otherwise the listed review the dialog opens on, or none.
  const [assigning, setAssigning] = useState<{ listed: IdentityReview | null } | null>(null);
  // null: closed. Otherwise the card the registry would take, and the rows listed when the dialog opened.
  const [issuing, setIssuing] = useState<{ target: IssueTarget; listed: readonly ListedCard[] } | null>(null);
  const item = useRef<HTMLLIElement>(null);
  const close = useCallback(() => { setAssigning(null); setIssuing(null); }, []);
  useFocusAfterClose(item, assigning !== null);
  useArrival(item, unit.id);
  return (
    <li ref={item} id={`unit-${unit.id}`} tabIndex={-1} className={styles.unit}>
      <h4 className={styles.label}>{unit.label}</h4>
      <DescriptionList items={[
        { label: 'Kind', value: <ValueText value={unit.kind} /> },
        { label: 'Area', value: <ValueText value={unit.area} /> },
        { label: 'Citation', value: <CitationControls label={unit.label} citations={unit.citations} /> },
        { label: 'Application code', value: unit.code ? <CopyableId id={unit.code} name="code" /> : NO_CODE },
      ]} />
      {unit.code ? (
        <UnitCards buildingId={buildingId} unit={unit} onIssue={(target, listed) => setIssuing({ target, listed })} />
      ) : <UnitAssignment unit={unit} onOpen={(listed) => setAssigning({ listed })} />}
      {assigning ? (
        <AssignCodeDialog buildingId={buildingId} unit={unit} floorLabel={floorLabel} listed={assigning.listed}
          onClose={close} />
      ) : null}
      {issuing ? (
        <IssueCardDialog buildingId={buildingId} unit={unit} floorLabel={floorLabel} target={issuing.target}
          listed={issuing.listed} onClose={close} />
      ) : null}
    </li>
  );
}
