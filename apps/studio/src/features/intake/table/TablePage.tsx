import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { Banner, Skeleton } from '@ulpin/ui';
import { ColumnsTable } from './ColumnsTable';
import { LearnerPanel } from './LearnerPanel';
import { mergeMetrics } from './model';
import { Progress, TableRefusal } from './Progress';
import { SourceHeader } from './SourceHeader';
import { StartJobs } from './StartJobs';
import { tableKey, useMappedChunks, useSourceCase, useTableJobs, useTableProfile } from './queries';
import { useTableStream } from './useTableStream';
import type { ChunkMapping } from './types';
import styles from './Table.module.css';

export function TablePage() {
  const { caseId = '', sourceId = '' } = useParams();
  return <TableImport key={`${caseId}:${sourceId}`} caseId={caseId} sourceId={sourceId} />;
}

function TableImport({ caseId, sourceId }: { caseId: string; sourceId: string }) {
  const [params] = useSearchParams();
  const profile = useTableProfile(caseId, sourceId);
  const sourceCase = useSourceCase(caseId);
  const stream = useTableStream(caseId, sourceId, params.get('rawJobId') ?? '', params.get('mappingJobId') ?? '');
  const { state, fallback, reconnect } = stream;
  const jobs = useTableJobs(caseId, sourceId, state.rawJobId, state.mappingJobId, fallback);
  const chunks = useMappedChunks(caseId, sourceId, jobs.mapping.data);
  const client = useQueryClient();
  useEffect(() => {
    if (state.refresh) void client.invalidateQueries({ queryKey: tableKey(caseId, sourceId) });
  }, [state.refresh, caseId, sourceId, client]);
  if (profile.isPending) return <div className={styles.page}><Skeleton /><Skeleton /><Skeleton /></div>;
  if (profile.error) return <div className={styles.page}><TableRefusal error={profile.error} /></div>;
  if (profile.data.version !== 'manual-tabular/1') {
    return <div className={styles.page}><Banner tone="warning">This retained source is not a table.</Banner></div>;
  }
  const mappings = chunks.flatMap((chunk) => chunk.data?.payload?.mapping ? [chunk.data.payload.mapping] : []);
  const errors = [sourceCase.error, jobs.raw.error, jobs.mapping.error, ...chunks.map((chunk) => chunk.error)];
  return (
    <div className={styles.page}>
      <Link to="/studio/work">Batches</Link>
      <SourceHeader profile={profile.data}
        name={sourceCase.data?.sources.find((source) => source.id === sourceId)?.name} />
      <Banner tone="info">
        Tables produce mapped draft rows, not buildings. Nothing enters the registry or the map.
      </Banner>
      <StartJobs profile={profile.data} />
      <Progress raw={jobs.raw.data} mapping={jobs.mapping.data} fallback={fallback} reconnect={reconnect}
        rawReason={sourceCase.data?.jobs.find((job) => job.id === state.rawJobId)?.error}
        mappingReason={sourceCase.data?.jobs.find((job) => job.id === state.mappingJobId)?.error} />
      {errors.filter(Boolean).map((error, index) => <TableRefusal key={index} error={error} />)}
      <MappingContent profile={profile.data} mappings={mappings} metrics={state.metrics} jobId={state.mappingJobId} />
    </div>
  );
}

function MappingContent({ profile, mappings, metrics, jobId }: {
  profile: import('./types').TableProfile; mappings: ChunkMapping[];
  metrics: import('./types').Metrics[]; jobId: string;
}) {
  const latest = mappings.at(-1);
  return (
    <>
      <ColumnsTable profile={profile} mapping={latest} />
      <LearnerPanel chunks={mergeMetrics(metrics, mappings, jobId)} />
    </>
  );
}
