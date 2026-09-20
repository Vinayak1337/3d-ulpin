/** Authored fictional import regression, with no borrowed fixture IDs or survey claims. */
import {writeFileSync} from 'node:fs';
const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const turn=([x,y])=>[Number((x*Math.cos(.42)-y*Math.sin(.42)+38).toFixed(8)),Number((x*Math.sin(.42)+y*Math.cos(.42)+7).toFixed(8))];
const frameId='FRAME-ORCHARD-ARRANGEMENTS',datum='ORCHARD-AUTHORED-ZERO: fictional local benchmark, not MSL';
const items=[
 {id:'orchard-atrium',label:'Orchard Atrium · courtyard and annex',type:'building',shape:'MultiPolygon',coordinates:[[rectangle(0,0,22,22),rectangle(6,6,10,10)],[rectangle(0,28,9,7)]],base:0,height:12,attributes:{floorCount:4}},
 {id:'angled-court',label:'Angled Court · rotated concave footprint',type:'building',coordinates:[[[0,0],[16,0],[16,6],[7,6],[7,17],[0,17],[0,0]].map(turn)],base:2,height:9,attributes:{floorCount:3}},
 {id:'upper-benchmark-house',label:'Upper Benchmark House · base +100 m',type:'building',coordinates:[rectangle(78,0,12,14)],base:100,height:12,attributes:{floorCount:4}},
 {id:'unresolved-height-house',label:'Unresolved Height House · footprint only',type:'building',coordinates:[rectangle(78,24,12,13)],base:8,height:null,attributes:{}},
 {id:'party-wall-west',label:'Party Wall West · valid shared boundary',type:'building',coordinates:[rectangle(0,58,10,13)],base:0,height:9,attributes:{floorCount:3}},
 {id:'party-wall-east',label:'Party Wall East · valid shared boundary',type:'building',coordinates:[rectangle(10,58,10,13)],base:0,height:12,attributes:{floorCount:4}},
 {id:'overlap-garden-north',label:'Garden North · overlapping source footprints',type:'building',coordinates:[rectangle(38,58,13,14)],base:0,height:9,attributes:{floorCount:3}},
 {id:'overlap-garden-south',label:'Garden South · overlapping source footprints',type:'building',coordinates:[rectangle(49,62,12,13)],base:0,height:12,attributes:{floorCount:4}},
 {id:'orchard-plaza',label:'Orchard Plaza · fictional public land',type:'open_area',coordinates:[rectangle(68,60,20,20)],base:0,height:0,attributes:{}},
 {id:'diagonal-street',label:'Diagonal Street · rotated exact road polygon',type:'road',coordinates:[rectangle(-6,-13,63,7).map(turn)],base:0,height:0,attributes:{}},
 {id:'crooked-lane',label:'Crooked Lane · concave exact road polygon',type:'road',coordinates:[[[-8,42],[97,42],[97,84],[91,84],[91,48],[-8,48],[-8,42]]],base:0,height:0,attributes:{}},
 {id:'survey-alignment-water',label:'Fictional water alignment · known diameter',type:'utility',shape:'LineString',coordinates:[[-5,45,-2],[54,45,-2],[92,45,-3],[92,82,-3]],base:null,height:null,attributes:{diameterM:.45,utilityType:'water'}},
 {id:'alignment-unsized',label:'Fictional alignment · diameter unavailable',type:'utility',shape:'LineString',coordinates:[[69,0,1],[69,39,1],[90,39,-1]],base:null,height:null,attributes:{utilityType:'unclassified'}},
];
const buildings=items.filter(item=>item.type==='building');
const parcelItems=buildings.map(item=>({id:`site-${item.id}`,label:`Fictional site for ${item.label.split(' ·')[0]}`,type:'parcel',shape:item.shape,coordinates:structuredClone(item.coordinates),base:item.base,height:0,attributes:{landUse:'synthetic_residential'}}));
items.push(...parcelItems);
const scene={
 schemaVersion:'1.0.0',
 metadata:{id:'ORCHARD-INDEPENDENT-ARRANGEMENTS',title:'Orchard Arrangements · independent fictional import',classification:'synthetic',description:'Wholly authored fixture for multipart, courtyard, rotated concave, elevated-base, shared-wall and overlap handling. The uploaded JSON is the original authored receipt; no survey evidence, official identifiers or real properties.',focalObjectId:'orchard-atrium',extent:[-10,-15,110,90],officialIssuance:false},
 frames:[{id:frameId,name:'ORCHARD-LOCAL-METRES',kind:'local_cartesian',horizontalUnit:'metre',verticalUnit:'metre',axisOrder:['east','north','up'],verticalDatum:datum}],
 objects:items.map(item=>({id:item.id,type:item.type,label:item.label,geometryId:`shape/${item.id}/r1`,status:'draft',sourceRecordIds:[],attributes:{...item.attributes,classification:'synthetic',evidenceNote:'Authored original upload geometry; not observed or surveyed.'}})),
 geometries:items.map(item=>({id:`shape/${item.id}/r1`,objectId:item.id,version:1,frameId,type:item.shape||'Polygon',coordinates:item.coordinates,baseElevationM:item.base,heightM:item.height,verticalDatum:datum,classification:'synthetic',status:'draft',sourceRecordIds:[]})),
 relations:buildings.map(item=>({id:`site-link/${item.id}`,fromId:`site-${item.id}`,toId:item.id,kind:'contains',status:'fixture_only',sourceRecordIds:[]})),
 sources:[],sourceRecords:[],observations:[],lineage:[],identifierAssertions:[],batches:[],issues:[],rights:[],
 sceneDecoration:{classification:'synthetic_visual_decoration',urbanForm:'open_block',ground:'paved',plotWalls:false,architecture:{roofEquipment:{maxHeightAboveRoofM:1.4}},trees:[{position:[75,67],heightM:6,radiusM:2.5},{position:[82,74],heightM:5,radiusM:2}],cars:[],parkPaths:[],buildingStyles:{'orchard-atrium':{palette:1,roofCore:false},'angled-court':{palette:3},'upper-benchmark-house':{palette:2},'party-wall-west':{palette:0},'party-wall-east':{palette:4}}},
};
writeFileSync(new URL('./independent-arrangements.json',import.meta.url),JSON.stringify(scene,null,2)+'\n');
console.log(JSON.stringify({buildings:buildings.length,objects:scene.objects.length,geometries:scene.geometries.length,file:'independent-arrangements.json'}));
