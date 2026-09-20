/** Bundled source packages, separate from saved registry areas. */
export const demoDatasets = [
  {id:'lake-view',name:'Lake View',description:'Reference neighbourhood',file:'lake-view-complete.zip',sha256:'94d6cd80cd0b2ac4c0d7b5abf6b01dc93a70e373e6e607aae3d746579beea087',buildings:49,floors:184},
  {id:'shiv-vihar',name:'Shiv Vihar',description:'Extension — Block A · supplied dataset',file:'provided-master.zip',sha256:'2a1668dfe509b828ef8696f96eff3d024ef3eff61d8c3b5249b6911a433fdd39',buildings:32,floors:5},
] as const;
export function demoDataset(id:unknown){return demoDatasets.find(dataset=>dataset.id===id);}
export function demoDatasetUrl(id:string){return `/studio/showcase?dataset=${encodeURIComponent(id)}`;}
