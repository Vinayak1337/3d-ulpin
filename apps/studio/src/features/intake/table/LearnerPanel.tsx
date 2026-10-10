import { DataTable } from '@ulpin/ui';
import { learnerTotals, unansweredTotalText } from './model';
import type { Metrics } from './types';
import styles from './Table.module.css';

/** `openQuestions` is the review's joined question count; undefined until the chunks that raise questions are read. */
export function LearnerPanel({ chunks, openQuestions }: { chunks: Metrics[]; openQuestions?: number }) {
  const totals = learnerTotals(chunks);
  return (
    <section className="ul-panel" aria-label="Mapping learner">
      <div className="ul-panel__head">
        <h2 className="ul-heading">Mapping learner</h2>
        <span className="ul-caption">Counts as published by the mapping job</span>
      </div>
      {chunks.some(isOldFallbackChunk) ? (
        <p className="ul-pad ul-help">
          Chunks without an unanswered count were recorded before the server counted unanswered fields. Their
          teacher fields with no teacher call are fallback columns, not teacher responses.
        </p>
      ) : null}
      {chunks.length ? <LearnerChunks chunks={chunks} /> : (
        <p className="ul-pad ul-muted">No chunk metrics received yet. Totals are unknown.</p>
      )}
      {chunks.length ? (
        <p className="ul-pad ul-caption">
          Summed over {totals.chunks} {totals.chunks === 1 ? 'chunk' : 'chunks'} ·
          {' '}{totals.teacherCalls} teacher calls ·
          {' '}{totals.memoryHits} memory hits ·
          {' '}{totals.studentFields} student fields · {totals.teacherFields} teacher fields ·
          {' '}Unanswered: {unansweredTotalText(totals)} ·
          {' '}{openQuestions === undefined ? 'Open questions: not read yet'
            : `${openQuestions} open questions, each counted once`} ·
          {' '}{Math.round(totals.latencyMs)} ms
        </p>
      ) : null}
    </section>
  );
}

/** An older chunk: no unanswered count, and teacher fields although no teacher was called. */
function isOldFallbackChunk(chunk: Metrics) {
  return chunk.unansweredFields === undefined && chunk.teacherCalls === 0 && chunk.teacherFields > 0;
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
          { header: 'Unanswered', numeric: true, cell: (chunk) => chunk.unansweredFields ?? 'Not reported' },
          { header: 'Columns needing input in this chunk', numeric: true, cell: (chunk) => chunk.needsInput },
          { header: 'Latency ms', numeric: true, cell: (chunk) => Math.round(chunk.latencyMs) },
          { header: 'Learner version', cell: (chunk) => chunk.learnerVersion ?? 'Unknown' },
        ]} />
    </div>
  );
}
