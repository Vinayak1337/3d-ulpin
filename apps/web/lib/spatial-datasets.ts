export type SavedSpatialDataset = {
 id:string; name:string; originalName:string; sha256:string; digest:string;
 buildingCount:number; floorCount:number; sourceCount:number; createdAt:string;
 classification:'synthetic'; revision:1;
};
export const savedDatasetUrl=(id:string)=>`/studio/showcase?saved=${encodeURIComponent(id)}`;

export type DatasetIdentityMatch={datasetId:string;datasetName:string;objectId:string;buildingId:string;floorId:string|null;identifier:string;label:string;href:string};
