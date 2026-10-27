import { z } from 'zod';
import { query } from '../../infrastructure/db';
import {ensureSpatialDatasets} from '../spatial/spatial-dataset-db';
import { fingerprint } from '../cases/domain';
import type {WorkItem, WorkQueueResult} from '../../shared/work-queue';
import {sourceProvenance} from '../../shared/spatial-datasets';
import { batchStep, itemPendingKinds } from '@ulpin/contracts/usp';
import { intakeItem, listedIntakeRows } from '../usp/ingestion/intake-ledger';
import { acceptedCandidates, coverageOf } from '../usp/ingestion/intake-evidence';

export const caseTableSourceIdsSql = `coalesce((SELECT jsonb_agg(s.id ORDER BY s.created_at DESC,s.id DESC)
  FROM sources s WHERE s.case_id=c.id AND s.profile='tabular-manual-v1'),'[]'::jsonb)`;

/** One metadata read bounded by the supplied visible cases; no original bytes or candidate bodies are read. */
async function readIntakeSummaries(caseIds: string[]) {
  const summaries = new Map<string, NonNullable<WorkItem['intakeSummary']>>();
  if (!caseIds.length) return summaries;
  const rows = (await query<SummaryRead & { id: string }>(`WITH items AS (
    SELECT i.*,coalesce(s.name,i.member_path) name,profile.job_id streamed_profile_job_id,
      s.inspection->'cellDerivative' cell_derivative,archive.name taken_out_of
    FROM usp_intake_items i LEFT JOIN sources s ON s.id=i.source_id
    LEFT JOIN sources archive ON i.parent_item_id IS NULL AND archive.case_id=s.case_id
      AND archive.id::text=s.inspection->'archiveMember'->>'parentSourceId'
    LEFT JOIN LATERAL (SELECT p.job_id FROM usp_streamed_profile_imports p WHERE p.case_id=i.case_id
      AND p.source_id=i.source_id AND i.parent_item_id IS NULL AND s.profile='large-original-v1'
      AND i.card->>'format'='geojson' ORDER BY p.created_at DESC LIMIT 1) profile ON true
    WHERE i.case_id=ANY($1::uuid[])
  ), links AS (
    SELECT case_id,item_id anchor_id,plan_ref->>'packageId' package_id,true drafted FROM items
    WHERE plan_ref->>'packageId' IS NOT NULL
    UNION SELECT i.case_id,i.item_id,part.result_ref->>'packageId',true FROM items i
      JOIN usp_intake_parts part ON part.item_id=i.item_id WHERE part.state='published'
    UNION SELECT case_id,anchor_item_id,package_id::text,false FROM usp_intake_targets WHERE case_id=ANY($1::uuid[])
  ), anchors AS (
    SELECT case_id,package_id,coalesce(min(anchor_id::text) FILTER (WHERE drafted),min(anchor_id::text)) anchor_id
    FROM links GROUP BY case_id,package_id
  ), packages AS (
    SELECT l.* FROM anchors l
    JOIN import_packages p ON p.id::text=l.package_id
    WHERE p.body->>'state'<>'COMMITTED'
      AND p.body->'review'->'packageRevision'=p.body->'revision'
      AND coalesce(p.body->'review'->>'inputFingerprint','')<>''
      AND NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id::text=l.anchor_id
        AND i.plan_ref->>'packageId'=l.package_id AND i.review_refusal_code IS NOT NULL)
      AND (EXISTS (SELECT 1 FROM usp_intake_targets t WHERE t.package_id=p.id AND t.readiness='ready')
        OR NOT EXISTS (SELECT 1 FROM usp_intake_targets t WHERE t.package_id=p.id))
      AND NOT EXISTS (SELECT 1 FROM usp_intake_confirmations c
        CROSS JOIN LATERAL jsonb_array_elements(c.packages) named
        WHERE c.case_id=l.case_id AND named->>'packageId'=l.package_id
          AND EXISTS (SELECT 1 FROM jobs j WHERE j.case_id=c.case_id AND j.operation='intake-run'
            AND j.status IN ('queued','running') AND j.payload->>'phase'='commit'
            AND j.payload->>'confirmationId'=c.confirmation_id::text))
  ) SELECT id,
    coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM items i WHERE i.case_id=batch.id),'[]') items,
    coalesce((SELECT jsonb_agg(anchor_id) FROM packages p WHERE p.case_id=batch.id),'[]') anchors,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',profile_id,'anchor',profile->'map'->>'anchorItemId'))
      FROM usp_intake_key_profiles WHERE case_id=batch.id),'[]') profiles,
    coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM usp_intake_evidence_confirmations c
      WHERE c.case_id=batch.id),'[]') confirmations,
    coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('job_status',j.status,'job_error',j.error,
      'retained',s.id IS NOT NULL AND s.revision IS NOT NULL AND s.sha256 IS NOT NULL AND s.bytes IS NOT NULL))
      FROM usp_intake_evidence_coverage c
      LEFT JOIN usp_intake_items i ON i.item_id=c.item_id AND i.case_id=c.case_id
      LEFT JOIN sources s ON s.id=i.source_id AND s.case_id=c.case_id
      LEFT JOIN jobs j ON j.id=c.job_id AND j.case_id=c.case_id AND j.operation='intake-evidence'
      WHERE c.case_id=batch.id),'[]') coverage,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',candidate_id,'profile',profile_id,'item',item_id))
      FROM usp_intake_evidence_candidates WHERE case_id=batch.id AND outcome='matched'
      AND jsonb_array_length(candidate->'anchors')=1),'[]') matches
    FROM unnest($1::uuid[]) AS batch(id)
    WHERE EXISTS (SELECT 1 FROM items WHERE case_id=batch.id)
      OR (NOT EXISTS (SELECT 1 FROM sources WHERE case_id=batch.id)
        AND NOT EXISTS (SELECT 1 FROM building_preparations WHERE case_id=batch.id))`, [caseIds])).rows;
  for (const row of rows) summaries.set(row.id, intakeSummary(row));
  return summaries;
}

type SummaryRead = {
  items: Parameters<typeof intakeItem>[0][]; anchors: string[];
  profiles: { id: string; anchor: string }[];
  confirmations: { profile_id: string; additions: string; pins: Parameters<typeof acceptedCandidates>[0] }[];
  coverage: (Parameters<typeof coverageOf>[0] & { profile_id: string; item_id: string; retained: boolean })[];
  matches: { id: string; profile: string; item: string }[];
};

function evidenceWaiting(row: SummaryRead, itemIds: Set<string>) {
  return row.profiles.filter(profile => {
    if (!itemIds.has(profile.anchor)) return false;
    const sources = row.coverage.filter(source => source.profile_id === profile.id);
    const current = row.confirmations.filter(confirmation => confirmation.profile_id === profile.id
      && !confirmation.pins.included.some(named => {
        const source = sources.find(source => source.item_id === named.itemId);
        return !source || source.job_id !== named.jobId || source.result_sha256 !== named.resultSha256
          || fingerprint(coverageOf(source)) !== fingerprint(named.coverage);
      }));
    if (current.some(confirmation => confirmation.additions === 'no_additions')) return false;
    const accepted = new Set(current.flatMap(confirmation => acceptedCandidates(confirmation.pins)));
    return !current.length || row.matches.some(match => match.profile === profile.id && !accepted.has(match.id)
      && sources.some(source => source.item_id === match.item && source.retained));
  }).length;
}

function intakeSummary(row: SummaryRead): NonNullable<WorkItem['intakeSummary']> {
  // Use the manifest's folding and projection, including plan validation and streamed layout state.
  const items = listedIntakeRows(row.items).map(intakeItem);
  const byId = new Map(items.map(item => [item.itemId, item]));
  const answers = evidenceWaiting(row, new Set(byId.keys()))
    + items.reduce((count, item) => count + itemPendingKinds(item, items).length, 0);
  const step = batchStep({ items, answers, confirmations: row.anchors.length });
  return { step, waiting: answers + Number(row.anchors.some(anchor => byId.has(anchor))) };
}

/** Only metadata is read here. Exact build/record eligibility is checked in the opened workspace. */
export async function readWorkQueue(url: URL): Promise<WorkQueueResult> {
  await ensureSpatialDatasets();
  const page = z.coerce.number().int().min(1).max(100000).parse(url.searchParams.get('page') || 1);
  const search = z.string().max(150).parse(url.searchParams.get('q') || '').trim();
  const filter = z.enum(['all','processing','recorded']).parse(url.searchParams.get('status') || 'all');
  const pageSize = 20;
  const result = await query(`WITH work AS (
    SELECT c.id, 'case'::text kind,c.name,coalesce(f.area_id,p.area_id) "areaId",a.name "areaName",CASE coalesce(f.body->>'worldStatus',p.body->'sourceWorkspace'->>'worldStatus') WHEN 'synthetic' THEN 'demonstration' WHEN 'observed' THEN 'real' ELSE NULL END "dataKind",
      b.building_id "buildingId",(SELECT count(*)::int FROM sources WHERE case_id=c.id) "sourceCount",
      c.updated_at "updatedAt",NULL::text state,j.status "jobStatus",
      EXISTS(SELECT 1 FROM registry_drafts d JOIN registry_reviews r ON r.draft_id=d.id WHERE d.case_id=c.id AND r.committed) "recordedHistory",
      b.body preparation,p.revision "packageRevision",c.revision "caseRevision",c.current_snapshot_id "snapshotId",f.revision "featureRevision",
      (SELECT jsonb_agg(r.body->>'preparationFingerprint') FROM registry_drafts d
        JOIN registry_reviews r ON r.draft_id=d.id WHERE d.case_id=c.id AND r.committed) receipts,
      ${caseTableSourceIdsSql} "tableSourceIds"
    FROM cases c LEFT JOIN building_preparations b ON b.case_id=c.id
    LEFT JOIN physical_features f ON f.id=b.building_id
    LEFT JOIN LATERAL (SELECT * FROM import_packages WHERE case_id=c.id ORDER BY (id=b.package_id) DESC NULLS LAST,created_at DESC LIMIT 1) p ON true
    LEFT JOIN map_areas a ON a.id=coalesce(f.area_id,p.area_id)
    LEFT JOIN LATERAL (SELECT status FROM jobs WHERE case_id=c.id AND (case_revision IS NULL OR case_revision=c.revision) ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created_at DESC LIMIT 1) j ON true
    WHERE NOT EXISTS(SELECT 1 FROM spatial_datasets sd WHERE sd.case_id=c.id) AND (NOT c.archived OR b.id IS NOT NULL) AND a.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM map_areas ar WHERE ar.site_id=c.site_id AND ar.archived_at IS NOT NULL)
      AND (b.id IS NOT NULL OR p.id IS NULL OR EXISTS(SELECT 1 FROM import_packages sp WHERE sp.case_id=c.id AND sp.body ? 'sourceWorkspace'))
    UNION ALL
    SELECT p.id,'import',p.body->>'name',p.area_id,a.name,CASE WHEN jsonb_array_length(p.body->'features')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.body->'features') f WHERE f->>'worldStatus' IS DISTINCT FROM 'synthetic') THEN 'demonstration' ELSE NULL END,NULL::uuid,
      jsonb_array_length(coalesce(p.body->'sourceRevisionIds','[]'::jsonb)),coalesce((SELECT max(created_at) FROM import_package_revisions WHERE package_id=p.id),p.created_at),p.state,NULL::text,
      p.state='COMMITTED',NULL::jsonb,NULL::int,NULL::int,NULL::uuid,NULL::int,NULL::jsonb,'[]'::jsonb
    FROM import_packages p JOIN map_areas a ON a.id=p.area_id
    WHERE a.archived_at IS NULL AND NOT (p.body ? 'sourceWorkspace')
      AND NOT EXISTS(SELECT 1 FROM building_preparations b WHERE b.package_id=p.id)
    UNION ALL
    SELECT d.id,'dataset',d.name,NULL::uuid,d.name,NULL::text,NULL::uuid,
      d.source_count,greatest(d.created_at,j.created_at,j.completed_at),'SAVED',j.status,false,
      NULL::jsonb,NULL::int,NULL::int,NULL::uuid,NULL::int,NULL::jsonb,'[]'::jsonb
    FROM spatial_datasets d
    LEFT JOIN LATERAL (SELECT status,created_at,completed_at FROM jobs WHERE case_id=d.case_id AND operation='dataset-spatial-inference' ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created_at DESC LIMIT 1) j ON true
    WHERE d.archived_at IS NULL
  ), filtered AS (SELECT * FROM work WHERE
    ($1='' OR strpos(lower(name||' '||coalesce("areaName",'')||' '||id::text),lower($1))>0)
    AND ($2='all' OR ($2='recorded' AND "recordedHistory") OR ($2='processing' AND "jobStatus" IN ('queued','running','dispatched','retrying')))
  ) SELECT (SELECT count(*)::int FROM filtered) total,
    coalesce((SELECT jsonb_agg(id) FROM work WHERE kind='case'),'[]'::jsonb) "caseIds",
    coalesce((SELECT jsonb_agg(row_to_json(paged)) FROM (SELECT * FROM filtered ORDER BY "updatedAt" DESC,id LIMIT $3 OFFSET $4) paged),'[]'::jsonb) items`,
    [search,filter,pageSize,(page-1)*pageSize]);
  const {total,items,caseIds} = result.rows[0];
  const summaries = await readIntakeSummaries(caseIds);
  const waitingBatches = [...summaries.values()].filter(summary => summary.waiting > 0).length;
  return {total,page,pageSize,waitingBatches,items: items.map((row: Omit<WorkItem,'provenance'> & {
    preparation: unknown; packageRevision: number; caseRevision: number;
    snapshotId?: string; featureRevision: number; receipts?: string[];
  }) => {
    const {preparation,packageRevision,caseRevision,snapshotId,featureRevision,receipts,...item} = row;
    const currentRecorded = !!preparation && !!receipts?.includes(fingerprint({preparation,packageRevision,caseRevision,snapshotId:snapshotId || undefined,featureRevision}));
    return {...item,currentRecorded,intakeSummary: item.kind === 'case' ? summaries.get(item.id) ?? null : null,
      provenance:sourceProvenance(item.dataKind,item.kind==='dataset')};
  })};
}
