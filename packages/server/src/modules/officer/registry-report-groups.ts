import type {ConsolidatedRegistryReport} from '@ulpin/contracts';
type Records=ConsolidatedRegistryReport['records'];

/** Display groups over the selected graph only. Each record appears exactly once;
 * multiple parents remain explicit rather than duplicating a unit's occupants. */
export function registryReportGroups(records:Records):ConsolidatedRegistryReport['groups'] {
  const byId=new Map(records.map(record=>[record.id,record]));
  const edges=new Map(records.map(record=>[record.id,[...new Set(record.links
    .filter(link=>['within','floor'].includes(link.type)&&byId.has(link.targetId)).map(link=>link.targetId))]]));
  const visited=new Set<string>(),cycles=new Set<string>();
  // Iterative DFS bounds work to the selected nodes and links, including malformed cycles.
  for(const record of records) {
    if(visited.has(record.id))continue;
    const stack=[{id:record.id,index:0}],active=new Map([[record.id,0]]);
    while(stack.length){
      const frame=stack[stack.length-1],next=edges.get(frame.id)??[];
      if(frame.index===next.length){visited.add(frame.id);active.delete(frame.id);stack.pop();continue;}
      const target=next[frame.index++],start=active.get(target);
      if(start!==undefined){for(let i=start;i<stack.length;i++)cycles.add(stack[i].id);continue;}
      if(!visited.has(target)){active.set(target,stack.length);stack.push({id:target,index:0});}
    }
  }
  const groups=new Map<string,ConsolidatedRegistryReport['groups'][number]>();
  for(const record of records){
    const links=record.links.filter(link=>['within','floor'].includes(link.type));
    const floors=links.filter(link=>link.type==='floor'||byId.get(link.targetId)?.kind==='floor');
    const candidates=[...new Set((floors.length?floors:links).map(link=>link.targetId))].sort();
    let kind:ConsolidatedRegistryReport['groups'][number]['kind'],parents:string[];
    if(cycles.has(record.id)){kind='cycle';parents=candidates;}
    else if(record.kind==='building'||record.kind==='floor'){kind=record.kind;parents=[record.id];}
    else if(candidates.length>1){kind='multiple_parents';parents=candidates;}
    else if(candidates.length===0){kind='unlinked';parents=[];}
    else if(!byId.has(candidates[0])){kind='outside_selection';parents=candidates;}
    else {
      const parent=byId.get(candidates[0])!;
      kind=parent.kind==='floor'?'floor':parent.kind==='building'?'building':'unlinked';parents=candidates;
    }
    const key=`${kind}:${parents.join(',')}`;
    let group=groups.get(key);
    if(!group){group={kind,parentIds:parents,recordIds:[]};groups.set(key,group);}
    group.recordIds.push(record.id);
  }
  const order={building:0,floor:1,multiple_parents:2,outside_selection:3,unlinked:4,cycle:5};
  return [...groups.values()].sort((a,b)=>order[a.kind]-order[b.kind]);
}
