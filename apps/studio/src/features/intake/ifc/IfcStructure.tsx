import { Banner, Skeleton } from '@ulpin/ui';
import { plural, structureView, type CandidateLine, type StoreyLine, type StructureView } from './structure-model';
import { useIfcStructure } from './useIfcStructure';
import styles from './IfcStructure.module.css';

/** A list of storeys stays open up to this many; a longer list starts collapsed. */
export const OPEN_STOREYS = 10;

/** IFC2: the building, storeys and spaces an IFC states, as candidates. Nothing here is confirmed or recorded. */
export function IfcStructure({ caseId, sourceId, name }: { caseId: string; sourceId: string; name: string }) {
  const { sourceCase, jobId, status } = useIfcStructure(caseId, sourceId);
  const error = sourceCase.error ?? status.error;
  const pending = sourceCase.isPending || (Boolean(jobId) && status.isPending);
  return <section className={styles.panel} aria-label={`Structure stated in ${name}`}>
    <h2 className="ul-heading">Structure stated in the file · {name}</h2>
    <p className="ul-help">
      Candidates read from the IFC as stated, without geometry. A storey is a level, not a unit.
      Nothing here is confirmed or recorded in the register.
    </p>
    {pending ? <Skeleton /> : null}
    {error ? <Banner tone="warning">{error.message}</Banner> : null}
    {!pending && !error ? <StructureBody view={structureView(status.data ?? null)} /> : null}
  </section>;
}

export function StructureBody({ view }: { view: StructureView }) {
  if (view.state === 'words') return <p>{view.words}</p>;
  if (view.state === 'not_read') return <p>
    The structure was not read: {view.reason} <span className="ul-caption ul-mono">{view.code}</span>
  </p>;
  const { tree } = view;
  return <div className={styles.tree}>
    <p className="ul-caption">{tree.counts}, as candidates</p>
    {tree.buildings.length ? <ul className={styles.list}>
      {tree.buildings.map(building => <li key={building.stepId}>
        <Line line={building} />
        <Storeys storeys={building.storeys} />
        {building.spaces.length ? <Spaces spaces={building.spaces} label="not under a storey" /> : null}
      </li>)}
    </ul> : <p>The file states no building.</p>}
    {tree.storeys.length ? <section aria-label="Storeys not under a building">
      <p className="ul-caption">Storeys the file does not place under a building</p>
      <Storeys storeys={tree.storeys} />
    </section> : null}
    {tree.spaces.length ? <Spaces spaces={tree.spaces} label="not under a building or storey" /> : null}
  </div>;
}

function Line({ line, detail }: { line: CandidateLine; detail?: string }) {
  return <div className={styles.line}>
    <span className={styles.name}>{line.title}</span>
    {detail ? <span>{detail}</span> : null}
    <span className="ul-caption">
      {line.kind} · <span className="ul-mono">STEP #{line.stepId}</span>
      {line.globalId ? <> · GlobalId <span className="ul-mono">{line.globalId}</span></> : null}
    </span>
  </div>;
}

function Storeys({ storeys }: { storeys: StoreyLine[] }) {
  if (!storeys.length) return <p className="ul-caption">No storey under this building in the file</p>;
  return <details className={styles.group} open={storeys.length <= OPEN_STOREYS}>
    <summary>{plural(storeys.length, 'storey')}</summary>
    <ul className={styles.list}>
      {storeys.map(storey => <li key={storey.stepId}>
        <Line line={storey} detail={storey.elevation} />
        {storey.spaces.length ? <Spaces spaces={storey.spaces} label="in this storey" />
          : <p className="ul-caption">No space under this storey in the file</p>}
      </li>)}
    </ul>
  </details>;
}

function Spaces({ spaces, label }: { spaces: CandidateLine[]; label: string }) {
  return <details className={styles.group}>
    <summary>{plural(spaces.length, 'space')} {label}</summary>
    <ul className={styles.list}>
      {spaces.map(space => <li key={space.stepId}><Line line={space} /></li>)}
    </ul>
  </details>;
}
