import { Link, useParams } from 'react-router';
import { Banner, Skeleton } from '@ulpin/ui';
import { ColumnsTable } from './ColumnsTable';
import { LearnerPanel } from './LearnerPanel';
import { mergeMetrics, reviewMapping, staleReasons } from './model';
import { Progress, TableRefusal } from './Progress';
import { RecipeReview } from './RecipeReview';
import { SourceHeader } from './SourceHeader';
import { StaleNotice } from './StaleNotice';
import { StartJobs } from './StartJobs';
import { TableRows } from './TableRows';
import { useTableData } from './useTableData';
import type { ChunkMapping, MappingJob, Metrics, TableProfile } from './types';
import styles from './Table.module.css';

/**
 * WD1. This page is the table-only step. Placing rows that hold coordinates is a separate batch action, whose GeoJSON
 * item can reach the map and a card; these words never say a table cannot.
 */
export function TableStepNotice() {
  return <Banner tone="info">
    This page is the table-only step: it maps columns into draft rows, not buildings, and by itself puts nothing in
    the registry or on the map. To place rows that hold coordinates, use Place on the map on this table&apos;s line
    in a batch (add the file to one if it is not in one). Its rows become a GeoJSON file taken in as its own item,
    which follows the batch&apos;s path to the map and to a property card that an officer confirms.
  </Banner>;
}

export function TablePage() {
  const { caseId = '', sourceId = '' } = useParams();
  return <TableImport key={`${caseId}:${sourceId}`} caseId={caseId} sourceId={sourceId} />;
}

function TableImport({ caseId, sourceId }: { caseId: string; sourceId: string }) {
  const { profile, sourceCase, stream, jobs, mappings, errors, freshness, windowed } =
    useTableData(caseId, sourceId);
  const { state, fallback, reconnect } = stream;
  if (profile.isPending) return <div className={styles.page}><Skeleton /><Skeleton /><Skeleton /></div>;
  if (profile.error) return <div className={styles.page}><TableRefusal error={profile.error} /></div>;
  if (profile.data.version !== 'manual-tabular/1') {
    return <div className={styles.page}><Banner tone="warning">This retained source is not a table.</Banner></div>;
  }
  const stale = staleReasons(freshness);
  return (
    <div className={styles.page}>
      <Link to="/studio/work">Batches</Link>
      <SourceHeader profile={profile.data}
        name={sourceCase.data?.sources.find((source) => source.id === sourceId)?.name} />
      <TableStepNotice />
      <StartJobs profile={profile.data} />
      {stale ? <StaleNotice reasons={stale} /> : null}
      <Progress raw={jobs.raw.data} mapping={jobs.mapping.data} fallback={fallback} reconnect={reconnect}
        rawReason={sourceCase.data?.jobs.find((job) => job.id === state.rawJobId)?.error}
        mappingReason={sourceCase.data?.jobs.find((job) => job.id === state.mappingJobId)?.error} />
      {errors.filter(Boolean).map((error, index) => <TableRefusal key={index} error={error} />)}
      <MappingContent profile={profile.data} mappings={mappings} metrics={state.metrics} stale={Boolean(stale)}
        jobId={state.mappingJobId} job={jobs.mapping.data} onApproved={stream.followApproved} />
      {windowed ? <TableRows caseId={caseId} sourceId={sourceId} /> : null}
    </div>
  );
}

function MappingContent({ profile, mappings, metrics, jobId, job, stale, onApproved }: {
  profile: TableProfile; mappings: ChunkMapping[]; metrics: Metrics[]; jobId: string; stale: boolean;
  job?: MappingJob; onApproved: () => void;
}) {
  const review = reviewMapping(mappings);
  return (
    <>
      <ColumnsTable profile={profile} mapping={review} />
      <LearnerPanel chunks={mergeMetrics(metrics, mappings, jobId)} openQuestions={review?.questions.length} />
      {review && job ? <RecipeReview key={jobId} profile={profile} mapping={review} job={job} stale={stale}
        onApproved={onApproved} /> : null}
    </>
  );
}
