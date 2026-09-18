import type {PoolClient,QueryResultRow} from "pg";
import type {WorldState} from "@ulpin/contracts";
import {pool} from "./db";
import {CORE_LEGACY_LIMITS,type LegacyReadArea,type LegacyReadFeature,type LegacyReadSite,type LegacyRegistryRecord,type LegacySourceMetadata,type LegacySpatialReadSlice} from "../../features/spatial/data/core-legacy-types";

export class LegacySpatialReadError extends Error {
  constructor(readonly status:number,readonly code:string,message:string){super(message);this.name="LegacySpatialReadError";}
}
export interface LegacyReadClient {
  query<R extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[]):Promise<{rows:R[]}>;
  release():void;
}
export type LegacyReadProvider=()=>Promise<LegacyReadClient>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateLegacyReadSelection(areaId:string,world:string):asserts world is WorldState {
  if(!UUID.test(areaId))throw new LegacySpatialReadError(400,"AREA_ID","A valid area identifier is required");
  if(!["observed","planned","hypothetical","synthetic"].includes(world))throw new LegacySpatialReadError(400,"WORLD_REQUIRED","Select one explicit spatial world");
}

/** No migration/getArea/listAreas helper: those existing paths may perform writes. */
export async function readLegacySpatialSlice(areaId:string,world:WorldState,connect:LegacyReadProvider=()=>pool().connect()):Promise<LegacySpatialReadSlice> {
  validateLegacyReadSelection(areaId,world);
  const client=await connect();
  let bytes=0;
  const bounded=async<R extends QueryResultRow>(sql:string,values:unknown[],limit:number):Promise<R[]>=>{
    const {rows}=await client.query<R>(sql,values);
    if(rows.length>limit)throw new LegacySpatialReadError(413,"LEGACY_READ_LIMIT","This area exceeds the bounded read profile; no records were silently truncated");
    bytes+=Buffer.byteLength(JSON.stringify(rows),"utf8");
    if(bytes>CORE_LEGACY_LIMITS.inputBytes)throw new LegacySpatialReadError(413,"LEGACY_READ_BYTES","This area exceeds the bounded payload profile");
    return rows;
  };
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    const areaRows=await bounded<LegacyReadArea>(`SELECT id,site_id AS "siteId",revision,name,reference
      FROM map_areas WHERE id=$1 AND archived_at IS NULL`,[areaId],1);
    const area=areaRows[0];if(!area)throw new LegacySpatialReadError(404,"AREA_NOT_FOUND","Area was not found");
    const featureRows=await bounded<LegacyReadFeature>(`SELECT f.id,f.revision,f.area_id AS "ownerAreaId",f.record_id AS "recordId",
      a.reference AS "ownerReference",(f.body-'properties'-'sourceGeometry') || jsonb_build_object('properties',jsonb_strip_nulls(jsonb_build_object(
        'attribution',CASE WHEN jsonb_typeof(f.body->'properties'->'attribution')='string' THEN left(f.body->'properties'->>'attribution',2048) END,
        'license',CASE WHEN jsonb_typeof(f.body->'properties'->'license')='string' THEN left(f.body->'properties'->>'license',256) END
      ))) AS body,
      ARRAY(SELECT DISTINCT g.area_id::text FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id
        WHERE m.feature_id=f.id ORDER BY g.area_id::text) AS "memberAreaIds"
      FROM physical_features f JOIN map_areas a ON a.id=f.area_id
      WHERE f.revision>0 AND f.body->>'worldStatus'=$2 AND
        (f.area_id=$1 OR EXISTS(SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE m.feature_id=f.id AND g.area_id=$1))
      ORDER BY f.id LIMIT $3`,[areaId,world,CORE_LEGACY_LIMITS.features+1],CORE_LEGACY_LIMITS.features);
    const linkedIds=featureRows.map(f=>f.recordId).filter((id):id is string=>id!==null);
    const siteRows=await bounded<LegacyReadSite>(`SELECT s.id,s.identifier,s.name,s.revision,s.frame,s.synthetic
      FROM registry_sites s WHERE s.id=$1 OR EXISTS(SELECT 1 FROM registry_records r WHERE r.site_id=s.id AND r.id=ANY($2::uuid[]))
      ORDER BY s.id LIMIT $3`,[area.siteId,linkedIds,CORE_LEGACY_LIMITS.sites+1],CORE_LEGACY_LIMITS.sites);
    const siteIds=siteRows.map(s=>s.id);
    const recordRows=await bounded<{id:string;identifier:string;revision:number;siteId:string;body:LegacyRegistryRecord}>(`SELECT id,identifier,revision,site_id AS "siteId",body-'rights' AS body FROM registry_records
      WHERE site_id=ANY($1::uuid[]) AND revision>0 ORDER BY id LIMIT $2`,[siteIds,CORE_LEGACY_LIMITS.records+1],CORE_LEGACY_LIMITS.records);
    const records=recordRows.map(row=>{
      // Registry bodies deliberately omit envelope fields. Match recordFrom
      // without requiring columns to be redundantly embedded in stored JSON.
      if(row.body.id!==undefined&&row.body.id!==row.id||row.body.revision!==undefined&&row.body.revision!==row.revision||row.body.siteId!==undefined&&row.body.siteId!==row.siteId)throw new LegacySpatialReadError(409,"LEGACY_RECORD_CONFLICT","Registry row and recorded revision disagree");
      return {...row.body,id:row.id,identifier:row.identifier,revision:row.revision,siteId:row.siteId};
    });
    const sourceIds=new Set(featureRows.map(f=>f.body.sourceRevisionId));
    for(const f of featureRows)for(const loc of [...(f.body.evidence??[]),...(f.body.verticalExtent?.evidence??[]),...(f.body.height?.evidence??[])])sourceIds.add(loc.sourceRevisionId);
    for(const record of records)for(const binding of [...(record.evidence??[]),...Object.values(record.geometry?.bindings??{}).filter(binding=>binding!==undefined)])sourceIds.add(binding.sourceId);
    const sources=await bounded<LegacySourceMetadata>(`SELECT id,case_id AS "caseId",family_id AS "familyId",revision,name,profile,
      mime_type AS "mimeType",bytes,sha256 FROM sources WHERE id=ANY($1::uuid[]) ORDER BY id LIMIT $2`,
      [[...sourceIds].sort(),CORE_LEGACY_LIMITS.sources+1],CORE_LEGACY_LIMITS.sources);
    const result:LegacySpatialReadSlice={schemaVersion:"ulpin-legacy-read/1",area,sites:siteRows,features:featureRows,records,sources:sources.map(s=>({...s,bytes:Number(s.bytes)}))};
    await client.query("COMMIT");
    return result;
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{client.release();}
}
