import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {PRIVATE_MVT_PROFILE as p,PrivateMvtCompilerSchema,PrivateMvtIdentityMapSchema,type PrivateMvtInput,type PrivateMvtCell} from '@ulpin/contracts/usp';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {sql} from '../../../infrastructure/sql-loader';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {mvtBoundsTx} from './bounds';

export function mvtCodeSha(){
  const paths=['packages/contracts/src/usp/private-mvt.ts','packages/server/src/modules/usp/tiles/grid.ts','packages/server/src/modules/usp/tiles/bounds.ts',
    'packages/server/src/modules/usp/tiles/compiler.ts','packages/server/src/modules/usp/tiles/service.ts',
    'packages/server/src/modules/usp/tiles/publication.ts','packages/server/src/modules/usp/tiles/storage.ts','database/sql/95-ingestion/private-mvt-cell.sql',
    'database/sql/95-ingestion/private-mvt-schema.sql','packages/server/src/infrastructure/storage.ts','packages/server/src/modules/usp/jobs.ts',
    'packages/server/src/modules/usp/ingestion/projected-vector.ts','packages/server/src/modules/usp/ingestion/events.ts',
    'apps/api/src/modules/ingestion/private-mvt.controller.ts','apps/api/src/modules/spatial/private-spatial.guard.ts'];
  return sha256(Buffer.concat(paths.flatMap(path=>[Buffer.from(path+'\0'),readFileSync(join(settings.repositoryRoot,path))])));
}
export async function mvtCompilerPinsTx(client:PoolClient,transform:unknown){
  const postgis=(await client.query('SELECT postgis_full_version() version')).rows[0].version;
  const base={codeSha256:mvtCodeSha(),policySha256:fingerprint(p),postgis,sourceTransformSha256:fingerprint(transform),
    sourceCrs:'EPSG:4326' as const,targetCrs:'EPSG:3857' as const,axisOrder:'always_xy' as const,verticalReference:null};
  return PrivateMvtCompilerSchema.parse({...base,sha256:fingerprint(base)});
}
/** Source authority/fence is checked by the caller before this trusted, role-limited query. */
export async function compilePrivateMvtCellTx(client:PoolClient,input:PrivateMvtInput,cell:PrivateMvtCell,deadline?:number){
  await mvtBoundsTx(client,deadline);
  await client.query('SET LOCAL search_path=pg_catalog,public');
  await client.query('SET LOCAL ROLE ulpin_private_mvt_compiler');
  // A failed statement aborts the transaction; rollback resets LOCAL role and
  // preserves the original SQL error instead of masking it with RESET failure.
  const row=(await client.query(sql('ingestion.mvt.cell'),[input.source.admissionJobId,input.source.sourceId,cell.z,cell.x,cell.y])).rows[0];
  await client.query('SET LOCAL ROLE NONE');
  const bytes=row.bytes as Buffer;
  if(!Buffer.isBuffer(bytes)||bytes.length>p.tileBytes||row.candidates>720||row.features.length>row.candidates)
    throw new AppError(422,'MVT_CELL_BUDGET','A prepared tile exceeds its byte or real feature-count profile; no features were truncated.');
  const identity=PrivateMvtIdentityMapSchema.parse({version:p.version,grid:p.grid,cell,namespace:input.source.namespace,features:row.features});
  const map=Buffer.from(JSON.stringify(identity));
  if(map.length>p.mapBytes)throw new AppError(422,'MVT_MAP_BUDGET','The exact canonical identity map exceeds its explicit byte bound.');
  return {bytes,map,identity,candidates:row.candidates,bounds:row.bounds as [number,number,number,number],dependencySha256:fingerprint(identity.features)};
}
