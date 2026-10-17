import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@ulpin/ui';
import { queueMapping, queueRawRows } from './queue';
import { TableRefusal } from './Progress';
import type { TableProfile } from './types';

/** Only a just-retained import carries queue keys. Opening an existing source page never starts a job. */
export function StartJobs({ profile }: { profile: TableProfile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const keys = (location.state as { queueKeys?: { raw: string; mapping: string } } | null)?.queueKeys;
  const started = useRef(false);
  const start = useMutation({ mutationFn: async () => {
    if (!keys) throw new Error('Import queue keys are missing. Reopen Add files to start an import.');
    const raw = await queueRawRows(profile, keys.raw);
    setParams((current) => {
      current.set('rawJobId', raw.jobId);
      return current;
    }, { replace: true, state: location.state });
    const mapping = await queueMapping(profile, raw.jobId, keys.mapping);
    return { rawJobId: raw.jobId, mappingJobId: mapping.jobId };
  }, onSuccess: (jobs) => {
    const next = new URLSearchParams(params);
    next.set('rawJobId', jobs.rawJobId);
    next.set('mappingJobId', jobs.mappingJobId);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true, state: null });
  } });
  useEffect(() => {
    if (keys && !started.current) {
      started.current = true;
      start.mutate();
    }
  }, [keys, start.mutate]);
  if (!keys) return null;
  return <div className="ul-stack" role="status">
    {start.isPending ? <p>Requesting raw-row and mapping jobs…</p> : null}
    {start.error ? <TableRefusal error={start.error} /> : null}
    {start.error ? <Button onClick={() => start.mutate()}>Retry job admission</Button> : null}
  </div>;
}
