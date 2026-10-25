import { Banner, Skeleton } from '@ulpin/ui';
import { outlineDrawing, outlineSources, plural, structureView, type CandidateLine, type OutlinesView,
  type StoreyLine, type StructureView } from './structure-model';
import { useIfcStructure } from './useIfcStructure';
import styles from './IfcStructure.module.css';

/** A list of storeys stays open up to this many; a longer list starts collapsed. */
export const OPEN_STOREYS = 10;
const NO_OUTLINES: OutlinesView = { state: 'none' };

/** IFC2: the building, storeys and spaces an IFC states, as candidates. Nothing here is confirmed or recorded. */
export function IfcStructure({ caseId, sourceId, name }: { caseId: string; sourceId: string; name: string }) {
  const { sourceCase, jobId, status, outlines } = useIfcStructure(caseId, sourceId);
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
    {!pending && !error ? <StructureBody view={structureView(status.data ?? null)} outlines={outlines} /> : null}
  </section>;
}

export function StructureBody({ view, outlines = NO_OUTLINES }: { view: StructureView; outlines?: OutlinesView }) {
  if (view.state === 'words') return <p>{view.words}</p>;
  if (view.state === 'not_read') return <p>
    The structure was not read: {view.reason} <span className="ul-caption ul-mono">{view.code}</span>
  </p>;
  const { tree } = view;
  return <div className={styles.tree}>
    <p className="ul-caption">{tree.counts}, as candidates</p>
    <OutlinesNote outlines={outlines} />
    {tree.buildings.length ? <ul className={styles.list}>
      {tree.buildings.map(building => <li key={building.stepId}>
        <Line line={building} />
        <Storeys storeys={building.storeys} outlines={outlines} />
        {building.spaces.length ? <Spaces spaces={building.spaces} label="not under a storey" /> : null}
      </li>)}
    </ul> : <p>The file states no building.</p>}
    {tree.storeys.length ? <section aria-label="Storeys not under a building">
      <p className="ul-caption">Storeys the file does not place under a building</p>
      <Storeys storeys={tree.storeys} outlines={outlines} />
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

function Storeys({ storeys, outlines }: { storeys: StoreyLine[]; outlines: OutlinesView }) {
  if (!storeys.length) return <p className="ul-caption">No storey under this building in the file</p>;
  return <details className={styles.group} open={storeys.length <= OPEN_STOREYS}>
    <summary>{plural(storeys.length, 'storey')}</summary>
    <ul className={styles.list}>
      {storeys.map(storey => <li key={storey.stepId}>
        <div className={styles.storey}>
          <Line line={storey} detail={storey.elevation} />
          <StoreyOutlineFigure storey={storey} outlines={outlines} />
        </div>
        {storey.spaces.length ? <Spaces spaces={storey.spaces} label="in this storey" />
          : <p className="ul-caption">No space under this storey in the file</p>}
      </li>)}
    </ul>
  </details>;
}

/** What the outline pass says for the whole file: its frame and unit, or why there is nothing to draw. */
function OutlinesNote({ outlines }: { outlines: OutlinesView }) {
  if (outlines.state === 'none') return null;
  if (outlines.state === 'words') return <p>{outlines.words}</p>;
  if (outlines.state === 'not_read') return <p>
    The storey outlines were not read: {outlines.reason} <span className="ul-caption ul-mono">{outlines.code}</span>
  </p>;
  return <p className="ul-help">
    Storey outlines are drawn in the file's own frame ({outlines.unit}), each fitted to its own size. They are not
    placed on the map, and no global transform was applied. They show shape only; nothing is measured.
  </p>;
}

/** One storey's outline beside it in the tree, or the reader's words for why it has none. */
function StoreyOutlineFigure({ storey, outlines }: { storey: StoreyLine; outlines: OutlinesView }) {
  if (outlines.state !== 'read') return null;
  const outline = outlines.storeys.get(storey.stepId);
  if (!outline) {
    const why = outlines.without.get(storey.stepId);
    return why ? <p className="ul-caption">{why}</p> : null;
  }
  const { viewBox, path } = outlineDrawing(outline, outlines.decimalPlaces);
  const { source, count, steps } = outlineSources(outline);
  return <figure className={styles.outline}>
    <svg className={styles.drawing} viewBox={viewBox} role="img" aria-label={`Outline of storey ${storey.title} `
      + `(STEP #${storey.stepId}) in the file's own frame, not placed on the map`}>
      <path d={path} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
    </svg>
    <figcaption className="ul-caption">
      {steps ? <>From {source} <span className="ul-mono">{steps}</span></> : <>From {count} {source} elements in the file</>}
    </figcaption>
  </figure>;
}

function Spaces({ spaces, label }: { spaces: CandidateLine[]; label: string }) {
  return <details className={styles.group}>
    <summary>{plural(spaces.length, 'space')} {label}</summary>
    <ul className={styles.list}>
      {spaces.map(space => <li key={space.stepId}><Line line={space} /></li>)}
    </ul>
  </details>;
}
