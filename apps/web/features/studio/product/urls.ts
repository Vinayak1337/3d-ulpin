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
 if(/\/(workspace|workspaces|cases)(\/|$)/.test(path))return 'workspace';
 return /\/(register|registry)(\/|$)/.test(path)?'register':'block';
}
export const productNavigation=[
 {key:'block',label:'Map',href:'/studio/datasets'},
 {key:'register',label:'Property Register',href:'/studio/registry'},
 {key:'workspace',label:'Plan Workspace',href:'/studio/workspaces'},
] as const;
