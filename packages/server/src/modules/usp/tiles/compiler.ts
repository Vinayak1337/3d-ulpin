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
    'packages/server/src/modules/usp/tiles/compiler.ts','packages/server/src/modules/usp/tiles/capacity.ts','packages/server/src/modules/usp/tiles/service.ts',
    'packages/server/src/modules/usp/tiles/publication.ts','packages/server/src/modules/usp/tiles/storage.ts','database/sql/95-ingestion/private-mvt-cell.sql',
    'database/sql/95-ingestion/private-mvt-schema.sql','packages/server/src/infrastructure/storage.ts','packages/server/src/modules/usp/jobs.ts',
    'packages/server/src/modules/usp/ingestion/projected-vector.ts','packages/server/src/modules/usp/ingestion/events.ts','packages/server/src/modules/usp/ingestion/semantic-chunks.ts',
    'packages/contracts/src/usp/semantic-chunks.ts','database/sql/95-ingestion/semantic-chunks.sql',
    'apps/api/src/modules/ingestion/private-mvt.controller.ts','apps/api/src/modules/spatial/private-spatial.guard.ts'];
  return sha256(Buffer.concat(paths.flatMap(path=>[Buffer.from(path+'\0'),readFileSync(join(settings.repositoryRoot,path))])));
}
export async function mvtCompilerPinsTx(client:PoolClient,transform:unknown){
  const postgis=(await client.query('SELECT postgis_full_version() version')).rows[0].version;
  const base={codeSha256:mvtCodeSha(),policySha256:fingerprint(p),postgis,sourceTransformSha256:fingerprint(transform),
    sourceCrs:'EPSG:4326' as const,targetCrs:'EPSG:3857' as const,axisOrder:'always_xy' as const,verticalReference:null};
  return PrivateMvtCompilerSchema.parse({...base,sha256:fingerprint(base)});
}
/** Immutable reads may use this reviewed complete compiler profile, never an unknown code/runtime pair.
 * Reconstructed from bed80b6e56964cc08e246f11abbe82c3251addc5 and matched read-only to the
 * retained full-admission generation. This approval does not authorize compilation or publication.
 */
const retainedReadProfile={codeSha256:'7ba0d09183675baa615a63a4f72add4f683bb83f1027321b2d61d09bb63fbc82',
  sha256:'c36c3ea4d51fd52914fa89c602e36867c3132715b06836b535c21a3f7072c6f5'};
// DOC-INGEST-01 changes only unrelated job enrollment and this immutable-read
// predicate. All remaining compiler fields, including PostGIS, must be exact.
const preDocumentCodeSha='3d060fda17b9cd542c4c8c2ffb29ad5fafb6cd28e34053235885ce13b3275656';
// AI-05B adds only point-job enrollment to the shared job authority. This
// reconstructed pre-point parent digest retains exact non-code pins.
const prePointCodeSha='20f90748a73f2051f3cabba45bc76432cdcae723381a497ddf81c4d7939ed339';
const preIFCReadCodeSha=new Set(['37f9c493f48724bc8d9627718a5781d3a3514e91d2055ab57492041729dbcbfc',
  '9a9790012ba12ed203ecde3660406a307f59b178399f704e8e9d3e5246c83c76']);
// DXF-02: reconstructed cfc679fd Git/LF and retained physical compiler bytes.
const preDXFReadCodeSha=new Set(['64b5b4f8ae0a0366a15139e3bdd6692e1753c06590073c7c81a8dfa3df34079e',
  'f44ff28bcf553f35e90950bc8729fde08eac62dee4033d4e86697f43f54df49a']);
// KML-02: exact fd36a4b9 Git/LF and actual physical compiler constituents.
const preKMLReadCodeSha=new Set(['3cf0b3859a113d4ba24f708d1fa8fa9aad124ac45fd0d21ec69f953e213fb358',
  '41bcb3aae67bc7b3c88016a8053db7747f469fc8d1c570157f8d6adf7bd06019']);
export function mvtReadCompilerCompatible(stored:PrivateMvtInput['compiler'],current:PrivateMvtInput['compiler'],hasSourceChunk=false){
  const valid=(pin:PrivateMvtInput['compiler'])=>{const {sha256,...base}=pin;return fingerprint(base)===sha256;};
  if(!valid(stored)||!valid(current))return false;
  if(fingerprint(stored)===fingerprint(current))return true;
  // Reviewed historical bytes only. Current writers never call this predicate.
  if((preIFCReadCodeSha.has(stored.codeSha256)||preDXFReadCodeSha.has(stored.codeSha256)||preKMLReadCodeSha.has(stored.codeSha256))&&current.codeSha256===mvtCodeSha()){
    const {sha256:_s,codeSha256:_sc,...oldProfile}=stored,{sha256:_c,codeSha256:_cc,...newProfile}=current;
    if(fingerprint(oldProfile)===fingerprint(newProfile))return true;
  }
  if(stored.codeSha256===preDocumentCodeSha||stored.codeSha256===prePointCodeSha){
    const {sha256:_storedHash,codeSha256:_storedCode,...storedProfile}=stored;
    const {sha256:_currentHash,codeSha256:_currentCode,...currentProfile}=current;
    if(fingerprint(storedProfile)===fingerprint(currentProfile))return true;
  }
  // The complete historical digest binds its original PostGIS runtime as well as code,
  // policy and transform. Installed compiler runtime changes do not rewrite those bytes.
  return !hasSourceChunk&&stored.codeSha256===retainedReadProfile.codeSha256&&stored.sha256===retainedReadProfile.sha256
    &&stored.policySha256===current.policySha256&&stored.sourceTransformSha256===current.sourceTransformSha256
    &&stored.sourceCrs===current.sourceCrs&&stored.targetCrs===current.targetCrs
    &&stored.axisOrder===current.axisOrder&&stored.verticalReference===current.verticalReference;
}
/** Source authority/fence is checked by the caller before this trusted, role-limited query. */
export async function compilePrivateMvtCellTx(client:PoolClient,input:PrivateMvtInput,cell:PrivateMvtCell,deadline?:number){
  await mvtBoundsTx(client,deadline);
  await client.query('SET LOCAL search_path=pg_catalog,public');
  await client.query('SET LOCAL ROLE ulpin_private_mvt_compiler');
  // A failed statement aborts the transaction; rollback resets LOCAL role and
  // preserves the original SQL error instead of masking it with RESET failure.
  const row=(await client.query(sql('ingestion.mvt.cell'),[input.source.admissionJobId,input.source.sourceId,cell.z,cell.x,cell.y,input.source.chunk?.pin.sequence??null])).rows[0];
  await client.query('SET LOCAL ROLE NONE');
  const bytes=row.bytes as Buffer;
  if(!Buffer.isBuffer(bytes)||bytes.length>p.tileBytes||row.candidates>720||row.features.length>row.candidates)
    throw new AppError(422,'MVT_CELL_BUDGET','A prepared tile exceeds its byte or real feature-count profile; no features were truncated.');
  const identity=PrivateMvtIdentityMapSchema.parse({version:p.version,grid:p.grid,cell,namespace:input.source.namespace,features:row.features});
  const map=Buffer.from(JSON.stringify(identity));
  if(map.length>p.mapBytes)throw new AppError(422,'MVT_MAP_BUDGET','The exact canonical identity map exceeds its explicit byte bound.');
  return {bytes,map,identity,candidates:row.candidates,bounds:row.bounds as [number,number,number,number],dependencySha256:fingerprint(identity.features)};
}
