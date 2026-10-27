import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// Part C's receipt from walk.ts's saved exchanges (no request sent here): the enrolment's seconds, the
// intake-zip-layers job's states over time, the ZIP's words, each layer item, the case's other jobs, and the second
// enrolment. The dispatcher's log lies under E:/BhuAayam-data/runtime/**, which this task may not open: its lines
// are not read, and the job is shown through the case read instead.
const scratch = 'E:/BhuAayam-data/task-data/reh6';
const walk = JSON.parse(readFileSync(`${scratch}/part-c.raw.json`, 'utf8'));
const exchange = n => JSON.parse(readFileSync(`${scratch}/c/${String(n).padStart(3, '0')}.json`, 'utf8'));
const caseRead = exchange(6).body;
const jobs = (caseRead.data ?? caseRead).jobs.map(job => ({ operation: job.operation, sourceId: job.sourceId,
  status: job.status, error: job.error, createdAt: job.createdAt, completedAt: job.completedAt }));
const { result } = walk;
const zipJob = result.jobs[0];
const seconds = (from, to) => Number(((Date.parse(to) - Date.parse(from)) / 1000).toFixed(3));
const layers = result.layers.map(({ itemId, member, memberSha256, sourceId, state, placement, reason,
  existingAreaId }) => ({ member, memberSha256, sourceId, itemId, state, placement, reason, existingAreaId,
  draftJob: jobs.find(job => job.sourceId === sourceId && job.operation === 'intake-draft') ?? null }));
const value = {
  at: new Date().toISOString(), api: walk.api, caseId: result.caseId, wallSeconds: walk.wallSeconds,
  stoppedAt: walk.stoppedAt, input: result.input, zipRoute: result.zipRoute, archive: result.archive,
  enrol: { route: 'POST /api/v1/ingestion/cases/{caseId}/intake/items', seconds: result.enrol.seconds,
    returnedAtOnce: result.enrol.seconds < 1, item: result.enrol.item },
  job: { route: 'GET /api/v1/cases/{caseId} (jobs)', ...zipJob,
    queuedToCompletedSeconds: seconds(zipJob.createdAt, zipJob.completedAt),
    rightAfterEnrol: result.jobsRightAfterEnrol.map(job => job.status),
    attempts: 'not reported by any product route (the case read gives id, status, error and times)',
    dispatcherLog: 'not read: it lies under E:/BhuAayam-data/runtime/**, which this task may not open' },
  trail: result.trail, restSeconds: result.restSeconds, quietReads: walk.quietReads,
  parentWords: result.parent.reason, parent: result.parent, layers, membersInsideArchive: result.memberRows,
  otherJobs: jobs.filter(job => job.operation !== 'intake-zip-layers'),
  again: { route: 'POST /api/v1/ingestion/cases/{caseId}/intake/items', seconds: result.again.seconds,
    sameItem: result.again.sameItem, jobsAfter: result.again.jobsAfter.map(job => `${job.id}: ${job.status}`),
    secondJobQueued: result.again.secondJobQueued },
  requests: walk.requests,
  expected: {
    enrolReturnedAtOnce: result.enrol.seconds < 1,
    oneJobQueuedAtEnrol: result.jobsRightAfterEnrol.length === 1
      && result.jobsRightAfterEnrol[0].status === 'queued',
    jobSucceeded: zipJob.status === 'succeeded',
    sixLayerItems: layers.length === 6,
    noSecondJob: result.again.secondJobQueued === false,
  },
};
save('part-c-zip.json', value);
console.log(JSON.stringify(value.expected), layers.map(layer => layer.memberSha256));
