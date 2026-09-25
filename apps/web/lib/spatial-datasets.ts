export type SavedSpatialDataset = {
 id:string; name:string; originalName:string; sha256:string; digest:string;
 buildingCount:number; floorCount:number; sourceCount:number; createdAt:string;
 classification:'synthetic'; revision:1; provenance:SourceProvenance;
};
export type SourceProvenance={classification:'observed'|'synthetic'|'planned'|'hypothetical'|'mixed'|'unknown';basis:'recorded'|'legacy_default'|'unavailable'};
export function sourceProvenance(kind:string|null|undefined,legacyDefault=false):SourceProvenance {
 if(legacyDefault)return {classification:'unknown',basis:'legacy_default'};
 const classification=kind==='real'?'observed':kind==='demonstration'?'synthetic':kind;
 if(classification==='observed'||classification==='synthetic'||classification==='planned'||classification==='hypothetical'||classification==='mixed')return {classification,basis:'recorded'};
 return {classification:'unknown',basis:'unavailable'};
}
export const sourceClassificationLabel=(value:SourceProvenance)=>value.classification==='unknown'?'Unknown source classification':`${value.classification[0].toUpperCase()}${value.classification.slice(1)} source`;
export const savedDatasetUrl=(id:string)=>`/studio/showcase?saved=${encodeURIComponent(id)}`;

export type DatasetIdentityMatch={datasetId:string;datasetName:string;objectId:string;buildingId:string;floorId:string|null;identifier:string;label:string;href:string};
