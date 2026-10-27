import assert from 'node:assert/strict';
import test from 'node:test';
import {IFCStructureSchema,IFCSummarySchema,type IFCInput} from '@ulpin/contracts/usp';
import {ifcSummary} from './ifc-processor';
import {fusionIFCMetadataProjection} from './source-fusion-ifc';

// Pass 1 output of services/geo/tests/fixtures/ifc1-structure-ifc4.ifc (hand-written, test-only).
const structure={state:'read',
  lengthUnit:{state:'supplied',stepId:3,entityType:'IfcSIUnit',prefix:'MILLI',name:'METRE'},nodes:[
  {stepId:1,entityType:'IfcProject',candidate:null,globalId:'0Kq2fRvcL1xBtS0Gx3Zs01',name:'Test project; not a record',
    longName:null,parentStepIds:[],relationStepIds:[]},
  {stepId:5,entityType:'IfcSite',candidate:null,globalId:'0Kq2fRvcL1xBtS0Gx3Zs02',name:'Test site',longName:null,
    parentStepIds:[1],relationStepIds:[12]},
  {stepId:6,entityType:'IfcBuilding',candidate:'building',globalId:'0Kq2fRvcL1xBtS0Gx3Zs03',name:'Test building',
    longName:"Building 'A'",parentStepIds:[5],relationStepIds:[13]},
  {stepId:7,entityType:'IfcBuildingStorey',candidate:'level',globalId:'0Kq2fRvcL1xBtS0Gx3Zs04',name:'Ground',
    longName:null,parentStepIds:[6],relationStepIds:[14],elevation:{state:'supplied',value:0,literal:'0.'}},
  {stepId:8,entityType:'IfcBuildingStorey',candidate:'level',globalId:'0Kq2fRvcL1xBtS0Gx3Zs05',name:'First',
    longName:null,parentStepIds:[6],relationStepIds:[14],elevation:{state:'absent'}},
  {stepId:9,entityType:'IfcSpace',candidate:'space',globalId:'0Kq2fRvcL1xBtS0Gx3Zs06',name:'G.01',longName:'Café',
    parentStepIds:[7],relationStepIds:[15]},
  {stepId:10,entityType:'IfcSpace',candidate:'space',globalId:'0Kq2fRvcL1xBtS0Gx3Zs07',name:'G.02',longName:null,
    parentStepIds:[7],relationStepIds:[15]},
  {stepId:11,entityType:'IfcSpace',candidate:'space',globalId:'0Kq2fRvcL1xBtS0Gx3Zs08',name:'1.01',
    longName:'Room; with semicolon',parentStepIds:[8],relationStepIds:[16]}]} as const;
const sourceSha256='a'.repeat(64),input={sourceSha256,sourceBytes:1737} as IFCInput;
const record=(stepId:number,entityType:string)=>({stepId,entityType,locator:{stepId},attributes:{}});
function native(value:unknown=structure){
  const records=[record(1,'IfcProject'),record(5,'IfcSite'),record(6,'IfcBuilding'),record(7,'IfcBuildingStorey'),
    record(8,'IfcBuildingStorey'),record(9,'IfcSpace'),record(10,'IfcSpace'),record(11,'IfcSpace')];
  return {schemaVersion:'ulpin-native-ifc/1',status:'available',scope:'source_native_metadata',
    source:{sha256:sourceSha256,bytes:1737,schema:'IFC4'},parser:{name:'IfcOpenShell',version:'0.8.5'},
    counts:{sourceEntities:18,projectedRecords:records.length},records,structure:value,
    projectUnits:[],
    georeference:{state:'missing_or_unqualified',inspectionFrame:'source_local',globalTransformApplied:false},
    semantics:{storeysAreLegalUnits:false,unitConversionApplied:false,rights:'not_assessed'},findings:[]};
}
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
const integrity=(error:any)=>error.code==='IFC_ARTIFACT_INTEGRITY';

test('a read structure reaches the summary as building, level and space candidates; still metadata only',()=>{
  const summary=ifcSummary(bytes(native()),input);
  assert.deepEqual(summary.structure,structure);
  assert.deepEqual([summary.buildingCount,summary.storeyCount,summary.spaceCount],[1,2,3]);
  assert.deepEqual([summary.metadataOnly,summary.geometry,summary.storeysAreLegalUnits],[true,'unsupported',false]);
  const roles=summary.structure?.state==='read'?summary.structure.nodes.map(node=>node.candidate):[];
  assert.deepEqual(roles,[null,null,'building','level','level','space','space','space']);
});

test('outline counts come only from a read artifact; old and failed passes leave the count absent',()=>{
  const outlines={state:'read',frame:'source_local',globalTransformApplied:false,lengthUnit:structure.lengthUnit,
    rounding:{decimalPlaces:3,sourcePrecision:0.001,contextStepIds:[20],
      method:'decimal_rounding_not_finer_than_context_precision'},
    storeys:[],withoutOutline:[{stepId:7,reason:'no_slab_or_space'},{stepId:8,reason:'no_slab_or_space'}]};
  // Test-only ring checks the transport contract, not an outline from an operational source.
  const storey={stepId:7,elementSource:'IfcSlab',elementStepIds:[30],
    polygons:[{exterior:[[0,0],[1,0],[0,1],[0,0]],interiors:[]}]};
  const summary=(value:unknown)=>ifcSummary(bytes({...native(),storeyOutlines:value}),input);
  assert.equal(summary(outlines).storeyOutlineCount,0);
  assert.equal(summary({...outlines,storeys:[storey]}).storeyOutlineCount,1);
  assert.equal(summary({state:'not_read',code:'OUTLINE_GEOMETRY',reason:'Geometry could not be read.'})
    .storeyOutlineCount,undefined);
  assert.equal(ifcSummary(bytes(native()),input).storeyOutlineCount,undefined);
  assert.throws(()=>summary({...outlines,globalTransformApplied:true}));
  assert.throws(()=>summary({...outlines,storeys:[{...storey,
    polygons:[{exterior:[[0,0],[1,0],[0,1],[1,1]],interiors:[]}]}]}));
});

test('structure and parser records must name the same buildings, storeys and spaces',()=>{
  const missing={...structure,nodes:structure.nodes.filter(node=>node.stepId!==10)};
  assert.throws(()=>ifcSummary(bytes(native(missing)),input),integrity);
  const retyped={...structure,nodes:structure.nodes.map(node=>node.stepId===10?{...node,entityType:'IfcBuildingStorey',
    candidate:'level',elevation:{state:'absent'}}:node)};
  assert.throws(()=>ifcSummary(bytes(native(retyped)),input),integrity);
});

test('a file above a ceiling keeps its counts and says why; an older artifact has no structure',()=>{
  const notRead={state:'not_read',code:'STRUCTURE_ENTITY_LIMIT',
    reason:'The IFC holds more structure entities than the scan keeps.'};
  const summary=ifcSummary(bytes(native(notRead)),input);
  assert.deepEqual(summary.structure,notRead);assert.equal(summary.spaceCount,3);
  const {structure:_,...older}=native();
  assert.equal(ifcSummary(bytes(older),input).structure,undefined);
});

test('the structure contract keeps stated values and refuses invented roles, elevations and parents',()=>{
  const storey={...structure.nodes[3],parentStepIds:[]},space={...structure.nodes[5],parentStepIds:[]};
  const parse=(nodes:unknown[])=>IFCStructureSchema.safeParse({...structure,nodes}).success;
  assert.equal(parse([...structure.nodes]),true);assert.equal(parse([storey,space]),true);
  assert.equal(parse([{...storey,elevation:undefined}]),false,'a storey states its elevation or says absent');
  assert.equal(parse([{...storey,elevation:{state:'supplied',value:0}}]),false,'a supplied value keeps its literal');
  assert.equal(parse([{...storey,candidate:'space'}]),false,'a storey is a level candidate');
  assert.equal(parse([{...space,candidate:'level'}]),false,'a space is never a level');
  assert.equal(parse([{...space,candidate:'unit'}]),false,'a storey or space is never a unit');
  assert.equal(parse([{...space,elevation:{state:'absent'}}]),false,'only storeys carry an elevation');
  assert.equal(parse([structure.nodes[5]]),false,'a parent must be a scanned node');
  assert.equal(parse([space,space]),false,'step ids are unique');
  const huge={...structure,nodes:[{...space,name:'x'.repeat(48*1024)}]};
  assert.equal(IFCStructureSchema.safeParse(huge).success,false,'the list stays within its output ceiling');
});

test('review receives the structure only when the summary and the native artifact agree',()=>{
  const summary=IFCSummarySchema.parse(ifcSummary(bytes(native()),input)),artifact={sha256:'b'.repeat(64),bytes:4096};
  const metadata=fusionIFCMetadataProjection([7],native(),summary,artifact);
  assert.deepEqual(metadata.summary.structure,structure);
  const changed={...structure,nodes:structure.nodes.map(node=>node.stepId===8?{...node,name:'Second'}:node)};
  assert.throws(()=>fusionIFCMetadataProjection([7],native(changed),summary,artifact),(error:any)=>error.status===422);
});
