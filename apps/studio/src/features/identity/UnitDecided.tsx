import { Banner, DescriptionList, Skeleton } from '@ulpin/ui';
import type { RecordedUnit } from '../review/recorded/model';
import type { AssignSubject } from './assignment';
import { readFailure } from './registryCard';

/** What a registry dialog decides about, read from the record: the unit, its floor, citation, revision and code. */
export function UnitDecided({ unit, floorLabel, subject, gaps, withCode = false }: {
  unit: RecordedUnit; floorLabel: string; subject: AssignSubject | string; gaps: string[]; withCode?: boolean;
}) {
  const cited = unit.citations.map((citation) => `${citation.source} · ${citation.locator}`).join('; ');
  const code = { label: 'Application code', value: <span className="ul-mono">{unit.code}</span> };
  return (
    <>
      <DescriptionList items={[
        { label: 'Unit', value: unit.label },
        { label: 'Floor', value: floorLabel },
        { label: 'Citation', value: cited || 'No citation recorded' },
        { label: 'Record revision', value: typeof subject === 'string' ? 'Not stated' : subject.revision },
        ...(withCode && unit.code ? [code] : []),
      ]} />
      {gaps.map((gap) => <p key={gap} className="ul-help">{gap}</p>)}
    </>
  );
}

/** A registry dialog before the record of its unit is read: a placeholder, or why the read failed. */
export function UnitUnread({ error }: { error: unknown }) {
  if (!error) return <Skeleton />;
  return <Banner tone="warning">The record of this unit could not be read. {readFailure(error)}</Banner>;
}
