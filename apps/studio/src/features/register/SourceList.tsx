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
          <span className="ul-caption">{source.file}<Retained source={retained.get(source.sourceId)} /></span>
          <ReadingNote sourceId={source.sourceId} />
        </li>
      ))}
    </ul>
  );
}

/** The revision, receipt date and short hash the register keeps for a source it retains. */
function Retained({ source }: { source: RetainedSource | undefined }) {
  if (!source) return null;
  const hash = <span className="ul-mono">{shortHash(source.sha256)}</span>;
  return <> · r{source.revision} · {formatDate(source.createdAt)} · {hash}</>;
}
