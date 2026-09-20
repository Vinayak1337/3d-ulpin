import { z } from 'zod';
import { query } from './db';
import {ensureSpatialDatasets} from './spatial-dataset-db';
import { fingerprint } from './domain';
import type {WorkItem, WorkQueueResult} from '../work-queue';

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
      (SELECT jsonb_agg(r.body->>'preparationFingerprint') FROM registry_drafts d JOIN registry_reviews r ON r.draft_id=d.id WHERE d.case_id=c.id AND r.committed) receipts
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
      p.state='COMMITTED',NULL::jsonb,NULL::int,NULL::int,NULL::uuid,NULL::int,NULL::jsonb
    FROM import_packages p JOIN map_areas a ON a.id=p.area_id
    WHERE a.archived_at IS NULL AND NOT (p.body ? 'sourceWorkspace')
      AND NOT EXISTS(SELECT 1 FROM building_preparations b WHERE b.package_id=p.id)
    UNION ALL
    SELECT d.id,'dataset',d.name,NULL::uuid,d.name,'demonstration',NULL::uuid,
      d.source_count,greatest(d.created_at,j.created_at,j.completed_at),'SAVED',j.status,false,NULL::jsonb,NULL::int,NULL::int,NULL::uuid,NULL::int,NULL::jsonb
    FROM spatial_datasets d
    LEFT JOIN LATERAL (SELECT status,created_at,completed_at FROM jobs WHERE case_id=d.case_id AND operation='dataset-spatial-inference' ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created_at DESC LIMIT 1) j ON true
    WHERE d.archived_at IS NULL
  ), filtered AS (SELECT * FROM work WHERE
    ($1='' OR strpos(lower(name||' '||coalesce("areaName",'')||' '||id::text),lower($1))>0)
    AND ($2='all' OR ($2='recorded' AND "recordedHistory") OR ($2='processing' AND "jobStatus" IN ('queued','running','dispatched','retrying')))
  ) SELECT (SELECT count(*)::int FROM filtered) total,
    coalesce((SELECT jsonb_agg(row_to_json(paged)) FROM (SELECT * FROM filtered ORDER BY "updatedAt" DESC,id LIMIT $3 OFFSET $4) paged),'[]'::jsonb) items`,
    [search,filter,pageSize,(page-1)*pageSize]);
  const {total,items} = result.rows[0];
  return {total,page,pageSize,items: items.map((row: WorkItem & {preparation: unknown; packageRevision: number; caseRevision: number; snapshotId?: string; featureRevision: number; receipts?: string[]}) => {
    const {preparation,packageRevision,caseRevision,snapshotId,featureRevision,receipts,...item} = row;
    const currentRecorded = !!preparation && !!receipts?.includes(fingerprint({preparation,packageRevision,caseRevision,snapshotId:snapshotId || undefined,featureRevision}));
    return {...item,currentRecorded};
  })};
}
