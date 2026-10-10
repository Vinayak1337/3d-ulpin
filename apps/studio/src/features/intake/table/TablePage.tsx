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
import { useTableData } from './useTableData';
import type { ChunkMapping, MappingJob, Metrics, TableProfile } from './types';
import styles from './Table.module.css';

export function TablePage() {
  const { caseId = '', sourceId = '' } = useParams();
  return <TableImport key={`${caseId}:${sourceId}`} caseId={caseId} sourceId={sourceId} />;
}

function TableImport({ caseId, sourceId }: { caseId: string; sourceId: string }) {
  const { profile, sourceCase, stream, jobs, mappings, errors, freshness } = useTableData(caseId, sourceId);
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
      <Banner tone="info">
        Tables produce mapped draft rows, not buildings. Nothing enters the registry or the map.
      </Banner>
      <StartJobs profile={profile.data} />
      {stale ? <StaleNotice reasons={stale} /> : null}
      <Progress raw={jobs.raw.data} mapping={jobs.mapping.data} fallback={fallback} reconnect={reconnect}
        rawReason={sourceCase.data?.jobs.find((job) => job.id === state.rawJobId)?.error}
        mappingReason={sourceCase.data?.jobs.find((job) => job.id === state.mappingJobId)?.error} />
      {errors.filter(Boolean).map((error, index) => <TableRefusal key={index} error={error} />)}
      <MappingContent profile={profile.data} mappings={mappings} metrics={state.metrics} stale={Boolean(stale)}
        jobId={state.mappingJobId} job={jobs.mapping.data} onApproved={stream.followApproved} />
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
      <LearnerPanel chunks={mergeMetrics(metrics, mappings, jobId)} />
      {review && job ? <RecipeReview key={jobId} profile={profile} mapping={review} job={job} stale={stale}
        onApproved={onApproved} /> : null}
    </>
  );
}
