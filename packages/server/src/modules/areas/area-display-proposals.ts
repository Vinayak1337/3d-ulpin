import type {PoolClient} from 'pg';
import type {ImportPackage,MapArea,PhysicalFeature} from '@ulpin/contracts';
import {AppError} from '../../infrastructure/errors';
import {documentAuthorityTx} from '../usp/ingestion/document-authority';
import {localOperatorSubject} from '../usp/principal';

/** A separate display projection. It never supplies geometry to analytical readers
 * and never deletes a previously recorded feature when a newer source rejects it. */
export async function displayAreaProposals(client:PoolClient,area:MapArea,packages:ImportPackage[]){
  const seen=new Set<string>(),result:(PhysicalFeature&{displayState:'unrecorded_proposal';proposalPackageId:string})[]=[];
  const current=(await client.query('SELECT id,revision FROM physical_features WHERE area_id=$1',[area.id])).rows;
  const revisions=new Map(current.map(row=>[row.id,row.revision]));
  for(const pkg of packages){
    if(pkg.sourceWorkspace)continue;
    for(const rejected of pkg.quarantine?.rejections??[])
      if(rejected.sourceKey!==null)seen.add(`${pkg.datasetNamespace}:${rejected.sourceKey}`);
    const candidates=pkg.features.filter(feature=>{
      const key=`${pkg.datasetNamespace}:${feature.sourceKey}`;
      if(seen.has(key))return false;
      seen.add(key);
      return pkg.state!=='COMMITTED'&&feature.areaId===area.id&&revisions.get(feature.id)===feature.revision;
    });
    if(!candidates.length)continue;
    const ids=[...new Set([...pkg.sourceRevisionIds,...candidates.map(feature=>feature.sourceRevisionId)])];
    const sources=(await client.query(`SELECT s.*,c.archived,c.site_id FROM sources s JOIN cases c ON c.id=s.case_id
      WHERE s.id=ANY($1::uuid[])`,[ids])).rows;
    const subject=localOperatorSubject();
    const unavailable=sources.length!==ids.length||sources.some(source=>source.archived||source.site_id!==area.siteId||
      [source.inspection?.actor,source.inspection?.largeOriginal?.operatorSubject,source.inspection?.documentOriginal?.subject].some(owner=>owner&&owner!==subject));
    if(unavailable){
      if(pkg.quarantine)throw new AppError(403,'AREA_SOURCE_DENIED','The import display source context is unavailable.');
      continue; // Older archived packages keep their existing context-read behavior.
    }
    for(const source of sources)await documentAuthorityTx(client,source);
    for(const feature of candidates)result.push({...feature,displayState:'unrecorded_proposal',proposalPackageId:pkg.id});
    if(result.length>2000)throw new AppError(422,'AREA_LIMIT','Choose an area with at most 2,000 display features.');
  }
  return result;
}
