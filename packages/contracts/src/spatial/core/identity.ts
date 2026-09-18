import { CORE_RELATION_POLICY, CoreIdentifierQuerySchema, CoreIdentityCommandSchema, CoreIdentityGraphSchema, type CoreEntity, type CoreIdentityGraph, type CoreRelation } from "./identity-schema";
import { coreFail, coreRefKey, nextCoreRevision, parseCore, type CoreRef } from "./scalars";

function unique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) coreFail(code, "Duplicate references/assertions are not permitted");
}
function acyclic(edges: readonly (readonly [string,string])[], group: string): void {
  const out = new Map<string,string[]>(), indegree = new Map<string,number>();
  for (const [from,to] of edges) { const next=out.get(from)||[];next.push(to);out.set(from,next);indegree.set(from,indegree.get(from)||0);indegree.set(to,(indegree.get(to)||0)+1); }
  const ready = [...indegree].filter(([,n])=>n===0).map(([id])=>id); let count=0;
  for(let cursor=0;cursor<ready.length;cursor++) { const id=ready[cursor];count++;for(const next of out.get(id)||[]) { const remaining=indegree.get(next)!-1;indegree.set(next,remaining);if(remaining===0)ready.push(next); } }
  if(count!==indegree.size)coreFail("RELATION_CYCLE", `Cycle in ${group} relationships`);
}

/** Complete identity metadata graph; geometry may remain unloaded or unavailable. */
export function validateCoreIdentityGraph(input: unknown): CoreIdentityGraph {
  const graph=parseCore(CoreIdentityGraphSchema,input), byRef=new Map<string,CoreEntity>();
  for(const entity of graph.entities) {
    const key=coreRefKey(entity.ref);
    if(byRef.has(key))coreFail("DUPLICATE_ENTITY", "A canonical reference appears more than once");
    byRef.set(key,entity);
    unique(entity.memberships.map(m=>`${coreRefKey(m.collection)}|${m.role}`),"DUPLICATE_MEMBERSHIP");
    unique(entity.identifiers.map(i=>JSON.stringify([i.scheme,i.issuer,i.value])),"DUPLICATE_IDENTIFIER");
    if(entity.identifiers.some(i=>i.scheme==="official_ulpin")&&entity.kind!=="parcel")coreFail("IDENTIFIER_SCOPE", "A reported parcel identifier cannot become a building identifier");
  }
  const replacementEdges: [string,string][]=[];
  for(const entity of graph.entities)if(entity.lifecycle.state==="retired") {
    const source=coreRefKey(entity.ref), targets=entity.lifecycle.replacedBy.map(coreRefKey);
    unique(targets,"DUPLICATE_SUCCESSOR");
    if((entity.lifecycle.mode==="split"&&targets.length<2)||(entity.lifecycle.mode==="merge"&&targets.length!==1))coreFail("SUCCESSOR_COUNT", "Retirement successors must match the split/merge operation");
    for(const key of targets) {
      const target=byRef.get(key);
      if(!target)coreFail("MISSING_SUCCESSOR", "A retired identity's successor is missing");
      if(key===source||target.kind!==entity.kind||target.ref.namespace!==entity.ref.namespace)coreFail("INVALID_SUCCESSOR", "Identity successors must be distinct objects of the same kind and namespace");
      replacementEdges.push([source,key]);
    }
  }
  acyclic(replacementEdges,"replacement");
  const changes=new Map<string,CoreEntity[]>();
  for(const entity of graph.entities)if(entity.lifecycle.state==="retired") {const group=changes.get(entity.lifecycle.changeId)||[];group.push(entity);changes.set(entity.lifecycle.changeId,group);}
  for(const group of changes.values()) {
    const first=group[0].lifecycle;
    if(first.state!=="retired")continue;
    if(group.some(e=>e.lifecycle.state!=="retired"||e.lifecycle.mode!==first.mode))coreFail("RETIREMENT_GROUP", "One identity change cannot mix split and merge");
    if(first.mode==="split"&&group.length!==1)coreFail("RETIREMENT_GROUP", "A split identifies exactly one original object");
    if(first.mode==="merge"&&(group.length<2||group.some(e=>e.lifecycle.state!=="retired"||coreRefKey(e.lifecycle.replacedBy[0])!==coreRefKey(first.replacedBy[0]))))coreFail("RETIREMENT_GROUP", "A merge identifies at least two originals and one shared successor");
  }
  unique(graph.relations.map(r=>r.id),"DUPLICATE_RELATION_ID");
  const edgeKeys: string[]=[], groups=new Map<string,[string,string][]>();
  for(const relation of graph.relations) {
    const fromKey=coreRefKey(relation.from), toKey=coreRefKey(relation.to), from=byRef.get(fromKey), to=byRef.get(toKey);
    if(!from||!to)coreFail("MISSING_ENDPOINT", "A relationship endpoint is missing from the identity graph");
    if(fromKey===toKey)coreFail("SELF_RELATION", "A relationship cannot target the same identity");
    const policy=CORE_RELATION_POLICY[relation.kind];
    if(!policy.pairs.some(([a,b])=>from.kind===a&&to.kind===b))coreFail("RELATION_KIND", "Relationship endpoint kinds are incompatible");
    if(relation.kind==="recorded_by"&&(to.ref.namespace!=="registry"||from.ref.namespace==="registry"))coreFail("RECORD_NAMESPACE", "A recorded-by link must explicitly target a distinct registry identity");
    if(relation.kind==="split_from"||relation.kind==="merged_from") {
      if(from.ref.namespace!==to.ref.namespace)coreFail("LINEAGE_NAMESPACE", "Identity lineage cannot silently change namespace");
      if(to.lifecycle.state!=="retired"||to.lifecycle.changeId!==relation.changeId||to.lifecycle.mode!==(relation.kind==="split_from"?"split":"merge")||!to.lifecycle.replacedBy.some(ref=>coreRefKey(ref)===fromKey))coreFail("LINEAGE_CHANGE", "Lineage must agree with the recorded retirement and successors");
    } else if(relation.changeId!==undefined)coreFail("LINEAGE_CHANGE", "Only lineage relationships carry an identity change ID");
    const pair=policy.symmetric?[fromKey,toKey].sort():[fromKey,toKey];
    edgeKeys.push(JSON.stringify([relation.kind,...pair]));
    if(policy.cycleGroup){const edges=groups.get(policy.cycleGroup)||[];edges.push([fromKey,toKey]);groups.set(policy.cycleGroup,edges);}
  }
  unique(edgeKeys,"DUPLICATE_RELATION");
  for(const [group,edges] of groups)acyclic(edges,group);
  return graph;
}

export interface CoreIdentityDelta {
  readonly changeId: string;
  readonly kind: "rename"|"split"|"merge";
  readonly reason: string;
  readonly before: readonly {readonly ref:CoreRef;readonly revision:number}[];
  readonly changed: readonly CoreEntity[];
  readonly created: readonly CoreEntity[];
  readonly lineage: readonly CoreRelation[];
}

/** Pure candidate planning. The caller must persist this under its own transaction/revision checks. */
export function planCoreIdentityChange(input: unknown, commandInput: unknown): CoreIdentityDelta {
  const graph=validateCoreIdentityGraph(input), command=parseCore(CoreIdentityCommandSchema,commandInput);
  if(graph.entities.some(e=>e.lifecycle.state==="retired"&&e.lifecycle.changeId===command.changeId)||graph.relations.some(r=>r.changeId===command.changeId))coreFail("CHANGE_ID_REUSE", "An identity change ID already belongs to recorded lineage");
  const existing=new Map(graph.entities.map(e=>[coreRefKey(e.ref),e]));
  const select=(ref:CoreRef,expected:number)=>{
    const entity=existing.get(coreRefKey(ref));
    if(!entity)coreFail("ENTITY_NOT_FOUND", "Identity command target is missing");
    if(entity.revision!==expected)coreFail("STALE_REVISION", "Identity changed since this command was prepared");
    if(entity.lifecycle.state!=="active")coreFail("RETIRED_IDENTITY", "A retired identity remains historical and cannot be edited");
    return entity;
  };
  const previous=command.kind==="merge"?command.sources.map(s=>select(s.ref,s.expectedRevision)):[select(command.target,command.expectedRevision)];
  unique(previous.map(e=>coreRefKey(e.ref)),"DUPLICATE_SOURCE");
  const created:CoreEntity[]=command.kind==="split"?[...command.children]:command.kind==="merge"?[command.result]:[];
  const byKey=(a:CoreEntity,b:CoreEntity)=>coreRefKey(a.ref)<coreRefKey(b.ref)?-1:coreRefKey(a.ref)>coreRefKey(b.ref)?1:0;
  previous.sort(byKey);created.sort(byKey);
  unique(created.map(e=>coreRefKey(e.ref)),"DUPLICATE_OUTPUT");
  for(const entity of created) {
    if(existing.has(coreRefKey(entity.ref)))coreFail("IDENTITY_REUSE", "A current or historical identity cannot be allocated again");
    if(entity.lifecycle.state!=="active"||entity.revision!==1)coreFail("INVALID_NEW_IDENTITY", "New identity candidates start active at revision one");
    if(previous.some(old=>old.kind!==entity.kind||old.ref.namespace!==entity.ref.namespace))coreFail("IDENTITY_KIND_CHANGE", "A split/merge cannot change the identity kind or namespace");
  }
  const changed:CoreEntity[]=previous.map(entity=>({ ...entity, revision:nextCoreRevision(entity.revision),
    ...(command.kind==="rename"?{label:command.label}:{lifecycle:{state:"retired" as const,mode:command.kind,changeId:command.changeId,replacedBy:created.map(e=>e.ref),reason:command.reason}}),
  }));
  const lineage:CoreRelation[]=created.flatMap((entity,childIndex)=>previous.map((parent,parentIndex)=>({
    id:`${command.changeId}:lineage:${childIndex}:${parentIndex}`,revision:1,kind:command.kind==="split"?"split_from" as const:"merged_from" as const,from:entity.ref,to:parent.ref,note:command.reason,changeId:command.changeId,
  })));
  const replacement=new Map(changed.map(e=>[coreRefKey(e.ref),e]));
  const validated=validateCoreIdentityGraph({entities:[...graph.entities.map(e=>replacement.get(coreRefKey(e.ref))||e),...created],relations:[...graph.relations,...lineage]});
  const byRef=new Map(validated.entities.map(e=>[coreRefKey(e.ref),e]));
  return Object.freeze({changeId:command.changeId,kind:command.kind,reason:command.reason,
    before:Object.freeze(previous.map(e=>Object.freeze({ref:e.ref,revision:e.revision}))),
    changed:Object.freeze(changed.map(e=>byRef.get(coreRefKey(e.ref))!)),created:Object.freeze(created.map(e=>byRef.get(coreRefKey(e.ref))!)),
    lineage:Object.freeze(validated.relations.filter(r=>lineage.some(l=>l.id===r.id))),
  });
}

/** Ambiguity is a result; labels are never implicit identity matches. */
export function resolveCoreIdentifier(input: unknown, queryInput: unknown) {
  const graph=validateCoreIdentityGraph(input),query=parseCore(CoreIdentifierQuerySchema,queryInput);
  const matches=graph.entities.filter(e=>e.identifiers.some(i=>i.scheme===query.scheme&&i.value===query.value&&(query.issuer===undefined||i.issuer===query.issuer))).map(e=>e.ref).sort((a,b)=>coreRefKey(a)<coreRefKey(b)?-1:coreRefKey(a)>coreRefKey(b)?1:0);
  return {status:matches.length===0?"missing" as const:matches.length===1?"matched" as const:"ambiguous" as const,matches};
}
