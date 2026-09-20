import type {SpatialMlResult,SpatialMlCalibration} from '@ulpin/contracts';
export type DatasetMlSource={id:string;name:string;mimeType:string;task:'floor-plan'|'building'|null;reason:string;pageCount?:number|null;pageCountError?:string};
export type DatasetMlRun={id:string;sourceId:string;sourceName:string;task:'floor-plan'|'building';page:number;modelId:string;status:string;error:string|null;createdAt:string;result:SpatialMlResult|null;review:DatasetMlReview|null};
export type DatasetMlReview={id:string;decision:'keep'|'reject';componentIds:string[];note:string;createdAt:string;calibration?:SpatialMlCalibration;lowerM?:number;upperM?:number;levelEvidence?:string;geometry?:{id:string;className:string;geometry:unknown;areaM2:number;volumeM3:number|null}[];checks?:{code:string;message:string;areaM2?:number}[]};
export type DatasetMlOverview={datasetId:string;name:string;digest:string;frameId:string;verticalDatum:string;sources:DatasetMlSource[];runs:DatasetMlRun[];retainedOnly:number};
