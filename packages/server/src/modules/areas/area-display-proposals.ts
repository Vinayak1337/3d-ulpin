import type {PoolClient} from 'pg';
import type {ImportPackage,MapArea,PhysicalFeature} from '@ulpin/contracts';
import {AppError} from '../../infrastructure/errors';
import {documentAuthorityTx} from '../usp/ingestion/document-authority';
import {localOperatorSubject} from '../usp/principal';
import {sourceOwnsArea} from './package-authority';

/** The fields of a package feature that decide whether an area displays it. */
export type ProposalFeature=Pick<PhysicalFeature,'id'|'sourceKey'|'areaId'|'revision'|'sourceRevisionId'>;
export type ProposalPackage<F extends ProposalFeature>=Omit<ImportPackage,'features'>&{features:F[]};
/** A condition on a package feature e that a rule read keeps, with its parameters from $2. */
export type RuleCondition={sql:string;values:unknown[]};
/** A package body whose features keep only the fields of ProposalFeature, for reads that draw by window, and only
 * the features the condition keeps. Every package naming a feature names it by the same identifier, so a condition
 * on the identifier alone leaves the rule's answer for the features it keeps unchanged. */
export const proposalRuleBody=(kept='true')=>`body||jsonb_build_object('features',(SELECT coalesce(jsonb_agg(
  jsonb_build_object('id',e->'id','sourceKey',e->'sourceKey','areaId',e->'areaId','revision',e->'revision',
  'sourceRevisionId',e->'sourceRevisionId') ORDER BY o),'[]'::jsonb) FROM jsonb_array_elements(body->'features')
  WITH ORDINALITY x(e,o) WHERE ${kept}))`;

/** A separate display projection. It never supplies geometry to analytical readers
 * and never deletes a previously recorded feature when a newer source rejects it. */
export async function displayAreaProposals(client:PoolClient,area:MapArea,packages:ImportPackage[],limit:number){
  return (await areaProposals(client,area,packages,limit)).flatMap(({packageId,features})=>features.map(feature=>
    ({...feature,displayState:'unrecorded_proposal' as const,proposalPackageId:packageId})));
}

/** The features an area displays as unrecorded proposals, package by package, newest package first: the first
 * package to name a source key or reject it decides it, and only an uncommitted package's unchanged features count.
 * Given only, the same rule for that one feature: every package still decides its source keys in order, but only
 * that feature's revision is read and only the package proposing it has its sources checked. */
export async function areaProposals<F extends ProposalFeature>(client:PoolClient,area:MapArea,
  packages:ProposalPackage<F>[],limit=Infinity,only?:string){
  const seen=new Set<string>(),result:{packageId:string;features:F[]}[]=[];
  const current=(await client.query(`SELECT id,revision FROM physical_features WHERE area_id=$1${only?' AND id=$2':''}`,
    only?[area.id,only]:[area.id])).rows;
  const revisions=new Map(current.map(row=>[row.id,row.revision]));
  let count=0;
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
    const unavailable=sources.length!==ids.length||sources.some(source=>source.archived||
      (source.site_id!==area.siteId&&!sourceOwnsArea(source,area.id))||
      [source.inspection?.actor,source.inspection?.largeOriginal?.operatorSubject,source.inspection?.documentOriginal?.subject].some(owner=>owner&&owner!==subject));
    if(unavailable){
      if(pkg.quarantine)throw new AppError(403,'AREA_SOURCE_DENIED','The import display source context is unavailable.');
      continue; // Older archived packages keep their existing context-read behavior.
    }
    for(const source of sources)await documentAuthorityTx(client,source);
    result.push({packageId:pkg.id,features:candidates});
    count+=candidates.length;
    if(count>limit){
      const most=limit.toLocaleString('en-US');
      throw new AppError(422,'AREA_LIMIT',`Choose an area with at most ${most} display features.`);
    }
  }
  return result;
}
