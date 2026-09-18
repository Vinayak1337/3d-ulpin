import type {PhysicalFeature,RegistryRecord} from "../../packages/contracts/src";
import type {LegacySpatialReadSlice} from "../../apps/web/features/spatial/data/core-legacy-types";

export const LEGACY_IDS={area:"11111111-1111-4111-8111-111111111111",site:"22222222-2222-4222-8222-222222222222",building:"33333333-3333-4333-8333-333333333333",source:"44444444-4444-4444-8444-444444444444",family:"55555555-5555-4555-8555-555555555555",case:"66666666-6666-4666-8666-666666666666",unit:"77777777-7777-4777-8777-777777777777",level:"88888888-8888-4888-8888-888888888888",otherArea:"99999999-9999-4999-8999-999999999999"};
export function legacySliceFixture():LegacySpatialReadSlice {
  const id=LEGACY_IDS;
  const reference={sourceCrs:"EPSG:4326",analysisCrs:"EPSG:32643",origin:[200000,3000000] as [number,number],anchor:[77,28] as [number,number],transformVersion:"declared-local/1",verticalReference:"area benchmark not automatically a building zero"};
  const points:[number,number][]=[[0,0],[10,0],[10,8],[0,8]];
  const feature:PhysicalFeature={id:id.building,identifier:"DEMO-B1",areaId:id.area,revision:2,sourceRevisionId:id.source,datasetNamespace:"demo-legacy",sourceKey:"feature-B1",name:"Legacy physical building",kind:"building",
    geometry:{type:"Polygon",coordinates:[[...points,points[0]]]},geographicGeometry:{type:"Polygon",coordinates:[[[77,28],[77.0001,28],[77.0001,28.0001],[77,28.0001],[77,28]]]},sourceGeometry:{},sourceReference:reference,
    geometryRole:"observed_ground_occupation",height:{state:"source_supported",value:6,unit:"m",meaning:"Building height",reference:"ground-relative"},worldStatus:"synthetic",properties:{privateRemark:"NEVER_COPY_RAW_PROPERTIES"},areaM2:80,
    evidence:[{sourceRevisionId:id.source,featureId:"feature-B1",jsonPointer:"/features/0",row:2}],representation:"physical_exterior",
  };
  const record=(recordId:string,kind:RegistryRecord["kind"],name:string):RegistryRecord=>({id:recordId,siteId:id.site,identifier:`DEMO-${kind}`,revision:3,name,alias:`legacy-${kind}`,kind,footprint:points,links:[],rights:[],evidence:[{sourceId:id.source,locator:"/features/0"}],synthetic:true});
  const building=record(id.building,"building","Recorded building"),floor=record(id.level,"floor","Recorded first level"),unit=record(id.unit,"space","Recorded flat");
  floor.links=[{targetId:id.building,type:"within"}];unit.links=[{targetId:id.level,type:"floor"}];
  unit.geometry={id:"unit-geometry",alias:"U1",name:"Recorded flat",kind:"unit",footprint:[[0,0],[5,0],[5,8],[0,8]],lower:0,upper:3,lowerVerified:true,upperVerified:true,bindings:{footprint:{sourceId:id.source,locator:"/units/U1"}},revision:3,levelLabel:"First level"};
  return {schemaVersion:"ulpin-legacy-read/1",area:{id:id.area,siteId:id.site,revision:5,name:"Legacy area",reference},sites:[{id:id.site,identifier:"DEMO-SITE",name:"Recorded site",revision:5,frame:{id:"site-frame",horizontalUnit:"m",verticalUnit:"m",benchmark:"BM-site"},synthetic:true}],
    features:[{id:id.building,revision:2,ownerAreaId:id.area,recordId:id.building,ownerReference:reference,memberAreaIds:[id.otherArea,id.area],body:feature}],records:[building,floor,unit],
    sources:[{id:id.source,caseId:id.case,familyId:id.family,revision:7,name:"legacy-fixture.geojson",profile:"parcel-local-json-v1",mimeType:"application/geo+json",bytes:1200,sha256:"a".repeat(64)}]};
}
