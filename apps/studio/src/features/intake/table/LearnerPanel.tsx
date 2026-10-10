import { DataTable } from '@ulpin/ui';
import { learnerTotals } from './model';
import type { Metrics } from './types';
import styles from './Table.module.css';

export function LearnerPanel({ chunks }: { chunks: Metrics[] }) {
  const totals = learnerTotals(chunks);
  return (
    <section className="ul-panel" aria-label="Mapping learner">
      <div className="ul-panel__head">
        <h2 className="ul-heading">Mapping learner</h2>
        <span className="ul-caption">Teacher (Sarvam) is off on this runtime; zero calls is a real count.</span>
      </div>
      {chunks.some((chunk) => chunk.teacherCalls === 0 && chunk.teacherFields > 0) ? (
        <p className="ul-pad ul-help">
          The server labels fallback fields as teacher fields even with no call. They are not teacher responses.
        </p>
      ) : null}
      {chunks.length ? <LearnerChunks chunks={chunks} /> : (
        <p className="ul-pad ul-muted">No chunk metrics received yet. Totals are unknown.</p>
      )}
      {chunks.length ? (
        <p className="ul-pad ul-caption">
          Totals · {totals.teacherCalls} teacher calls · {totals.memoryHits} memory hits ·
          {' '}{totals.studentFields} student fields · {totals.teacherFields} teacher fields ·
          {' '}{totals.needsInput} questions · {Math.round(totals.latencyMs)} ms
        </p>
      ) : null}
    </section>
  );
}

function LearnerChunks({ chunks }: { chunks: Metrics[] }) {
  return (
    <div className={styles.scroll} tabIndex={0} aria-label="Learner table, scroll horizontally">
      <DataTable caption="Learner metrics per chunk" rows={chunks} rowKey={(chunk) => String(chunk.chunkIndex)}
        columns={[
          { header: 'Chunk', numeric: true, cell: (chunk) => chunk.chunkIndex + 1 },
          { header: 'Layout', cell: (chunk) => chunk.layout },
          { header: 'Teacher calls', numeric: true, cell: (chunk) => chunk.teacherCalls },
          { header: 'Memory hits', numeric: true, cell: (chunk) => chunk.memoryHits },
          { header: 'Student fields', numeric: true, cell: (chunk) => chunk.studentFields },
          { header: 'Teacher fields', numeric: true, cell: (chunk) => chunk.teacherFields },
          { header: 'Questions', numeric: true, cell: (chunk) => chunk.needsInput },
          { header: 'Latency ms', numeric: true, cell: (chunk) => Math.round(chunk.latencyMs) },
          { header: 'Learner version', cell: (chunk) => chunk.learnerVersion ?? 'Unknown' },
        ]} />
    </div>
  );
}
