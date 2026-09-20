/** Presentation routes only. Never rewrite API endpoints, source locators or IDs. */
export function studioProductUrl(value:string):string {
 if(!value.startsWith('/')||value.startsWith('//')||value.startsWith('/api/')||value.startsWith('/studio'))return value;
 const cut=value.search(/[?#]/),path=cut<0?value:value.slice(0,cut),suffix=cut<0?'':value.slice(cut);
 if(path==='/blocks')return '/studio/datasets'+suffix;
 if(path.startsWith('/blocks/'))return '/studio/areas/'+path.slice(8)+suffix;
 if(path==='/register')return '/studio/registry'+suffix;
 if(path.startsWith('/register/'))return '/studio/registry/'+path.slice(10)+suffix;
 if(path.startsWith('/properties/'))return '/studio'+path+suffix;
 if(path==='/workspace')return '/studio/workspaces'+suffix;
 if(path.startsWith('/workspace/'))return '/studio/cases/'+path.slice(11)+suffix;
 if(path==='/delhi')return '/studio/source-study'+suffix;
 return value;
}
export function productFamily(path:string):'block'|'register'|'workspace'{
 if(/\/(work|workspace|workspaces|cases|add-files|imports)(\/|$)/.test(path))return 'workspace';
 return /\/(register|registry)(\/|$)/.test(path)?'register':'block';
}
export const productNavigation=[
 {key:'workspace',label:'Batches',href:'/studio/work'},
 {key:'block',label:'Map',href:'/studio/datasets'},
 {key:'register',label:'Register',href:'/studio/registry'},
] as const;

/** Keep the full incoming context when an identifier resolves to a canonical route. */
export function studioResolutionUrl(destination:string,values:Record<string,string|string[]|undefined>,selectedIdentity=false):string {
 const url=new URL(destination,'http://local');
 for(const [key,value] of Object.entries(values)){
  if(value===undefined)continue;
  // An explicit ambiguity choice owns its identity; source, page and vertical scope still travel with it.
  if(selectedIdentity && (['record','building','feature'].includes(key) || (key==='area' && url.searchParams.has(key))))continue;
  // A supplied context takes precedence over inferred area context; repeated values stay repeated.
  url.searchParams.delete(key);
  for(const item of Array.isArray(value)?value:[value])url.searchParams.append(key,item);
 }
 return url.pathname+url.search;
}
