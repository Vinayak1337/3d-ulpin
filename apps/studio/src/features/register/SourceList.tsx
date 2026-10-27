import type { BuildingLedger } from '@ulpin/api-client/draft';
import { EvidenceChip, formatDate } from '@ulpin/ui';
import type { BuildingRegister } from '../../api/queries';
import { shortHash } from '../../local/workflow';
import { ReadingNote } from './ReadingNote';
import styles from './RegisterPage.module.css';

export type ListedSource = BuildingLedger['sources'][number];
type RetainedSource = BuildingRegister['sources'][number];

/** A building's sources: each as its chip, what the register retains of it, and the server's word on its reading. */
export function SourceList({ sources, retained, onOpen }: {
  sources: ListedSource[]; retained: ReadonlyMap<string, RetainedSource>; onOpen: (source: ListedSource) => void;
}) {
  return (
    <ul className={styles.sources}>
      {sources.map((source) => (
        <li key={source.sourceId}>
          <EvidenceChip kind={source.kind} source={source.name} locator={source.summary}
            onOpen={() => onOpen(source)} />
          <FileLine file={source.file === source.name ? null : source.file} source={retained.get(source.sourceId)} />
          <ReadingNote sourceId={source.sourceId} />
        </li>
      ))}
    </ul>
  );
}

/** The file name when the chip does not show it, and the revision, receipt date and short hash the register keeps. */
function FileLine({ file, source }: { file: string | null; source: RetainedSource | undefined }) {
  if (!file && !source) return null;
  const hash = source ? <span className="ul-mono">{shortHash(source.sha256)}</span> : null;
  return (
    <span className="ul-caption">
      {file}
      {file && source ? ' · ' : null}
      {source ? <>r{source.revision} · {formatDate(source.createdAt)} · {hash}</> : null}
    </span>
  );
}
