import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

// Swagger cannot infer the returned values of framework-independent services.
// These shapes follow their exported service result types. Input schemas come
// directly from the Zod validators used at the controller boundary.
export const uuid = z.string().uuid();
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const world = z.enum(['observed', 'planned', 'hypothetical', 'synthetic']);
export const revision = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const requestKey = z.object({ requestKey: uuid }).strict();

export function wire(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;
}

export function requestWire(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input',
    override: ({jsonSchema}) => { delete jsonSchema.readOnly; },
  }) as Record<string, unknown>;
}

const error = {
  type: 'object', required: ['error'], properties: {
    error: { type: 'object', required: ['code', 'message', 'requestId'], properties: {
      code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string', format: 'uuid' },
      details: { description: 'Redacted, operation-specific validation detail when available' },
    } },
  },
};
export function ApiResult(status: number, schema: Record<string, unknown>, errors: number[] = [400, 403, 404, 409, 422, 503], headers?: Record<string, unknown>) {
  return applyDecorators(
    ApiResponse({ status, schema: schema as never, ...(headers ? { headers: headers as never } : {}) }),
    ...errors.map(code => ApiResponse({ status: code, schema: error as never })),
  );
}

export const binary = { type: 'string', format: 'binary' };
export const retired = {
  type: 'object', required: ['error'], properties: {
    error: { type: 'object', required: ['code', 'message', 'replacement'], properties: {
      code: { type: 'string', enum: ['RETIRED_SYNTHETIC_INTAKE', 'RETIRED_SYNTHETIC_CALIBRATION'] },
      message: { type: 'string' }, replacement: { type: 'string' },
    } },
  },
};
export const provenance = { type: 'object', required: ['classification', 'basis'], properties: {
  classification: { type: 'string', enum: ['observed', 'synthetic', 'planned', 'hypothetical', 'mixed', 'unknown'] },
  basis: { type: 'string', enum: ['recorded', 'legacy_default', 'unavailable'] },
} };
export const savedDataset = { type: 'object', required: ['id','name','originalName','sha256','digest','revision','classification','buildingCount','floorCount','sourceCount','createdAt','provenance'], properties: {
  id: { type:'string', format:'uuid' }, name: { type:'string' }, originalName:{type:'string'},
  sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}, digest:{type:'string',pattern:'^[a-f0-9]{64}$'},
  revision:{type:'integer',enum:[1]}, classification:{type:'string',enum:['synthetic']},
  buildingCount:{type:'integer'},floorCount:{type:'integer'},sourceCount:{type:'integer'},
  createdAt:{type:'string',format:'date-time'},provenance,
} };
export const identifier = { type:'object', required:['objectId','buildingId','floorId','identifier','label','aliases','twoDIds','method'], properties:{
  objectId:{type:'string'},buildingId:{type:'string'},floorId:{type:'string',nullable:true},
  identifier:{type:'string'},label:{type:'string'},aliases:{type:'array',items:{type:'string'}},
  twoDIds:{type:'array',items:{type:'string'}},method:{type:'string',enum:['application-3d-v1']},
} };
export const identifierMatch = { ...identifier, required:[...identifier.required,'datasetId','datasetName','href'],
  properties:{...identifier.properties,datasetId:{type:'string',format:'uuid'},datasetName:{type:'string'},href:{type:'string'}} };
export const mlModel = { type:'object',required:['id','task','sha256','profileVersion','name','license','ready'],properties:{
  id:{type:'string'},task:{type:'string',enum:['floor-plan','building']},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
  profileVersion:{type:'string'},name:{type:'string'},license:{type:'string'},ready:{type:'boolean'},
  reason:{type:'string'},evaluation:{type:'string'},
} };
export const mlStatus = {type:'object',required:['models','maxBatchItems'],properties:{
  models:{type:'array',items:mlModel},maxBatchItems:{type:'integer'},
}};
const calibration = {type:'object',required:['rasterSha256','imagePoints','worldPoints','frame','reason'],properties:{
  rasterSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},imagePoints:{type:'array',minItems:2,maxItems:2,items:{type:'array',minItems:2,maxItems:2,items:{type:'number'}}},
  worldPoints:{type:'array',minItems:2,maxItems:2,items:{type:'array',minItems:2,maxItems:2,items:{type:'number'}}},
  frame:{type:'string'},reason:{type:'string'},
}};
const image = {type:'object',required:['sha256','width','height','url'],properties:{
  sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},width:{type:'integer'},height:{type:'integer'},url:{type:'string'},
}};
const coordinatePosition = {type:'array',items:{type:'number'}};
const coordinateRing = {type:'array',items:coordinatePosition};
const polygonCoordinates = {type:'array',items:coordinateRing};
const component = {type:'object',required:['id','className','score','geometry'],properties:{
  id:{type:'string'},className:{type:'string'},score:{type:'number'},
  geometry:{type:'object',required:['type','coordinates'],properties:{type:{type:'string',enum:['Polygon','MultiPolygon']},
    coordinates:{description:'Retained raster pixel rings; Polygon or MultiPolygon nesting follows type.',
      anyOf:[polygonCoordinates,{type:'array',items:polygonCoordinates}]}}},
}};
export const mlResult = {type:'object',required:['model','raster','mask','components','receipt'],properties:{
  model:{type:'object',required:['id','sha256'],properties:{id:{type:'string'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
  raster:image,mask:image,components:{type:'array',items:component},
  receipt:{type:'object',additionalProperties:true,description:'Processor-specific retained model and raster receipt fields'},
}};
const mlScope = {oneOf:[
  {type:'object',required:['kind','packageId'],properties:{kind:{const:'package'},packageId:{type:'string',format:'uuid'}}},
  {type:'object',required:['kind','caseId','caseRevision','sourceId','sourceRevision','sourceSha256','sourceBytes','page','frame','region','locator','calibration','applicability'],properties:{
    kind:{const:'source'},caseId:{type:'string',format:'uuid'},caseRevision:{type:'integer'},sourceId:{type:'string',format:'uuid'},
    sourceRevision:{type:'integer'},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},sourceBytes:{type:'integer'},page:{type:'integer'},
    frame:{type:'object',required:['kind','width','height','rotation'],properties:{kind:{const:'pdf_display_page_top_left_points'},width:{type:'number'},height:{type:'number'},rotation:{type:'integer'}}},
    region:{type:'object',required:['x','y','width','height'],properties:{x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}}},
    locator:{type:'object',required:['kind','page'],properties:{kind:{const:'pdf_page'},page:{type:'integer'}}},calibration:{type:'null'},applicability:{const:'not_assessed'},
  }},
]};
export const mlItem = {type:'object',required:['id','batchId','packageId','sourceRevisionId','sourceSha256','partId','page','task','modelId','modelSha256','inputFingerprint','state','currentJobId','attempts','applications','createdAt','updatedAt'],properties:{
  id:{type:'string',format:'uuid'},batchId:{type:'string',format:'uuid'},packageId:{type:['string','null'],format:'uuid'},scope:mlScope,
  sourceRevisionId:{type:'string',format:'uuid'},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
  partId:{type:['string','null'],format:'uuid'},page:{type:'integer'},task:{type:'string',enum:['floor-plan','building']},
  modelId:{type:'string'},modelSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},inputFingerprint:{type:'string'},
  state:{type:'string',enum:['queued','running','succeeded','empty','failed','blocked','cancelled']},
  currentJobId:{type:'string',format:'uuid'},attempts:{type:'array',items:{type:'object',required:['jobId','state','createdAt'],
    properties:{jobId:{type:'string',format:'uuid'},state:{type:'string'},createdAt:{type:'string',format:'date-time'},completedAt:{type:'string',format:'date-time'},error:{type:'string'},errorCode:{type:'string'}}}},
  result:mlResult,applications:{type:'array',items:{type:'object',required:['requestKey','inputFingerprint','calibration','entityId','selections','property','factIds','packageRevision','appliedAt'],
    properties:{requestKey:{type:'string',format:'uuid'},inputFingerprint:{type:'string'},calibration,entityId:{type:'string',format:'uuid'},
      selections:{type:'array',items:{type:'object',required:['componentId','subject'],properties:{componentId:{type:'string'},subject:{type:'string'}}}},
      property:{type:'string',enum:['space.geometry','outline.geometry']},factIds:{type:'array',items:{type:'string',format:'uuid'}},packageRevision:{type:'integer'},appliedAt:{type:'string',format:'date-time'}}}},
  retainedFootprintCalibration:calibration,
  footprintDrafts:{type:'array',items:{type:'object',required:['packageId','inputFingerprint','createdAt'],properties:{packageId:{type:'string',format:'uuid'},inputFingerprint:{type:'string'},createdAt:{type:'string',format:'date-time'}}}},
  createdAt:{type:'string',format:'date-time'},updatedAt:{type:'string',format:'date-time'},
}};
export const mlBatch = {type:'object',required:['id','packageId','requestKey','createdAt','items'],properties:{
  id:{type:'string',format:'uuid'},packageId:{type:['string','null'],format:'uuid'},scope:mlScope,requestKey:{type:'string',format:'uuid'},
  createdAt:{type:'string',format:'date-time'},items:{type:'array',items:mlItem},
}};
export const review = {type:'object',required:['id','decision','componentIds','note','createdAt'],properties:{
  id:{type:'string',format:'uuid'},decision:{type:'string',enum:['keep','reject']},componentIds:{type:'array',items:{type:'string'}},
  note:{type:'string'},createdAt:{type:'string',format:'date-time'},calibration,
  lowerM:{type:'number'},upperM:{type:'number'},levelEvidence:{type:'string'},
  geometry:{type:'array',items:{type:'object',required:['id','className','geometry','areaM2','volumeM3'],properties:{
    id:{type:'string'},className:{type:'string'},geometry:component.properties.geometry,areaM2:{type:'number'},volumeM3:{type:'number',nullable:true},
  }}},checks:{type:'array',items:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'},areaM2:{type:'number'}}}},
}};
export const datasetMlOverview = {type:'object',required:['datasetId','name','digest','frameId','verticalDatum','sources','runs','retainedOnly'],properties:{
  datasetId:{type:'string',format:'uuid'},name:{type:'string'},digest:{type:'string',pattern:'^[a-f0-9]{64}$'},
  frameId:{type:'string'},verticalDatum:{type:'string'},retainedOnly:{type:'integer'},
  sources:{type:'array',items:{type:'object',required:['id','name','mimeType','task','reason'],properties:{
    id:{type:'string',format:'uuid'},name:{type:'string'},mimeType:{type:'string'},task:{type:'string',enum:['floor-plan','building'],nullable:true},
    reason:{type:'string'},pageCount:{type:'integer',nullable:true},pageCountError:{type:'string'},
  }}},
  runs:{type:'array',items:{type:'object',required:['id','sourceId','sourceName','task','page','modelId','status','error','createdAt','result','review'],properties:{
    id:{type:'string',format:'uuid'},sourceId:{type:'string',format:'uuid'},sourceName:{type:'string'},
    task:{type:'string',enum:['floor-plan','building']},page:{type:'integer'},modelId:{type:'string'},
    status:{type:'string'},error:{type:'string',nullable:true},createdAt:{type:'string',format:'date-time'},
    result:{...mlResult,nullable:true},review:{...review,nullable:true},
  }}},
}};
export const sourceLocator = {type:'object',required:['sourceRevisionId'],properties:{
  sourceRevisionId:{type:'string',format:'uuid'},page:{type:'integer'},row:{type:'integer'},partId:{type:'string',format:'uuid'},
  featureId:{type:'string'},jsonPointer:{type:'string'},region:{type:'object',required:['x','y','width','height','unit'],properties:{
    x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'},unit:{type:'string',enum:['normalized']}}},
}};
const canonicalGeometry = {type:'object',required:['type'],properties:{
  type:{type:'string',enum:['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection']},
  coordinates:{type:'array',description:'Native coordinate dimensions and nesting follow the retained geometry type; no CRS or Z is inferred.',items:{}},
  geometries:{type:'array',items:{type:'object',required:['type'],properties:{type:{type:'string'},coordinates:{type:'array',items:{}}}}},
}};
export const areaReference = {type:'object',required:['sourceCrs','analysisCrs','origin','anchor','transformVersion','verticalReference'],properties:{
  sourceCrs:{type:'string'},analysisCrs:{type:'string'},origin:{type:'array',minItems:2,maxItems:2,items:{type:'number'}},
  anchor:{type:'array',minItems:2,maxItems:2,items:{type:'number'}},transformVersion:{type:'string'},verticalReference:{type:'string'},
}};
export const coordinateFrame = {type:'object',required:['id','horizontalUnit','verticalUnit','benchmark'],properties:{
  id:{type:'string'},horizontalUnit:{type:'string',enum:['m']},verticalUnit:{type:'string',enum:['m']},benchmark:{type:'string'},
}};
export const height = {type:'object',required:['state','value','unit','meaning','reference'],properties:{
  state:{type:'string',enum:['unresolved','estimated','source_supported','reviewed','unknown']},value:{type:'number',nullable:true},
  unit:{type:'string',enum:['m']},meaning:{type:'string'},reference:{type:'string'},
  originalValue:{description:'Unchanged original source value'},originalUnit:{type:'string'},
  evidence:{type:'array',items:sourceLocator},claimId:{type:'string'},method:{type:'string',enum:['native_parse','human_entry','derived']},
}};
const feature = {type:'object',required:['id','identifier','areaId','revision','sourceRevisionId','datasetNamespace','evidence','representation','sourceKey','name','kind','sourceGeometry','geometry','geographicGeometry','height','worldStatus','properties','areaM2'],properties:{
  id:{type:'string',format:'uuid'},identifier:{type:'string'},areaId:{type:'string',format:'uuid'},revision:{type:'integer'},
  sourceRevisionId:{type:'string',format:'uuid'},datasetNamespace:{type:'string'},evidence:{type:'array',items:sourceLocator},
  representation:{type:'string',enum:['physical_exterior','physical_context']},sourceKey:{type:'string'},name:{type:'string'},
  kind:{type:'string',enum:['building','parcel','road','public_land','utility']},
  sourceGeometry:{type:'object',additionalProperties:true,description:'Retained source-native geometry payload'},
  sourceReference:areaReference,geometry:canonicalGeometry,geographicGeometry:canonicalGeometry,height,
  worldStatus:{type:'string',enum:['observed','planned','hypothetical','synthetic']},
  properties:{type:'object',additionalProperties:true,description:'Source-native property keys'},areaM2:{type:'number',nullable:true},
  geometryRole:{type:'string'},semantics:{type:'object',properties:{
    geometryRole:{type:'string'},evidenceState:{type:'string'},levelReference:{type:'string'},sourceDate:{type:'string'},
    validFrom:{type:'string'},validTo:{type:'string'},horizontalUncertaintyM:{type:'number'},approvalStatus:{type:'string'},
    floorCount:{type:'integer'},assetId:{type:'string'}}},
  verticalExtent:{type:'object',required:['lower','upper','unit','reference','evidenceState','evidence'],properties:{
    lower:{type:'number'},upper:{type:'number'},unit:{type:'string',enum:['m']},reference:{type:'string'},
    evidenceState:{type:'string'},evidence:{type:'array',items:sourceLocator}}},
  utilityProfile:{type:'object',additionalProperties:true},
}};
const fact = {type:'object',required:['id','entityId','property','value','evidence','method','evidenceState','worldStatus'],properties:{
  id:{type:'string',format:'uuid'},entityId:{type:'string',format:'uuid'},subject:{type:'string'},property:{type:'string'},
  value:{description:'Canonical fact value is explicitly dynamic by property'},unit:{type:'string'},referenceFrameId:{type:'string'},
  evidence:{type:'array',items:sourceLocator},method:{type:'string',enum:['native_parse','ai_extraction','human_entry','derived']},
  evidenceState:{type:'string',enum:['unresolved','estimated','source_supported','reviewed']},
  worldStatus:{type:'string',enum:['observed','planned','hypothetical','synthetic']},
}};
const finding = {type:'object',required:['id','category','code','message','featureIds'],properties:{
  id:{type:'string'},category:{type:'string',enum:['geometric','coverage','rule','document']},code:{type:'string'},message:{type:'string'},
  featureIds:{type:'array',items:{type:'string'}},areaM2:{type:'number'},volumeM3:{type:'number'},geometry:canonicalGeometry,
  geographicGeometry:canonicalGeometry,participants:{type:'array',items:feature},method:{type:'string'},
  inputRevisions:{type:'array',items:{type:'object',required:['featureId','revision','sourceRevisionId'],properties:{
    featureId:{type:'string'},revision:{type:'integer'},sourceRevisionId:{type:'string',format:'uuid'}}}},
  evidence:{type:'array',items:sourceLocator},quantities:{type:'object',additionalProperties:{type:'number'}},
  limitations:{type:'array',items:{type:'string'}},
}};
export const packageProjection = {type:'object',required:['id','schemaVersion','areaId','name','datasetNamespace','revision','state','sourceRevisionIds','features','questions','factCandidates','parts','warnings','createdAt'],properties:{
  id:{type:'string',format:'uuid'},schemaVersion:{type:'string',enum:['ulpin-canonical/2']},areaId:{type:'string',format:'uuid'},
  name:{type:'string'},datasetNamespace:{type:'string'},revision:{type:'integer'},
  state:{type:'string',enum:['RECEIVED','NEEDS_INPUT','READY_FOR_REVIEW','REVIEWED','COMMITTED']},
  sourceRevisionIds:{type:'array',items:{type:'string',format:'uuid'}},features:{type:'array',items:feature},
  sourceWorkspace:{type:'object',required:['caseId','frame','worldStatus','areaReferenceFingerprint'],properties:{
    caseId:{type:'string',format:'uuid'},frame:coordinateFrame,worldStatus:{type:'string'},
    areaReferenceFingerprint:{type:'string'}}},
  selectedClaimIds:{type:'array',items:{type:'string'}},
  factDecisions:{type:'array',items:{type:'object',required:['claimId','reason','time','actor'],properties:{
    claimId:{type:'string'},reason:{type:'string'},time:{type:'string',format:'date-time'},actor:{type:'string'}}}},
  questions:{type:'array',items:{type:'object',required:['id','entityId','property','message','blocks'],properties:{
    kind:{type:'string',enum:['missing_height','conflicting_claims']},id:{type:'string'},entityId:{type:'string'},
    property:{type:'string'},message:{type:'string'},blocks:{type:'string'},
    answer:{type:'object',required:['choice','reason'],properties:{choice:{type:'string',enum:['keep_2d','estimate','select_claim']},
      value:{type:'number'},reason:{type:'string'},claimId:{type:'string'}}}}}},
  factCandidates:{type:'array',items:fact},
  parts:{type:'array',items:{type:'object',required:['id','sourceRevisionId','locator','text','entityIds'],properties:{
    id:{type:'string',format:'uuid'},sourceRevisionId:{type:'string',format:'uuid'},locator:{type:'string'},text:{type:'string'},
    entityIds:{type:'array',items:{type:'string',format:'uuid'}},copiedFrom:{type:'object',required:['caseId','sourceRevisionId','sourceHash','sourceRevision','sourceProfile','locator','reason','copiedAt','actor'],properties:{
      caseId:{type:'string',format:'uuid'},sourceRevisionId:{type:'string',format:'uuid'},sourceHash:{type:'string'},
      sourceRevision:{type:'integer'},sourceProfile:{type:'string'},locator:{type:'string'},reason:{type:'string'},
      copiedAt:{type:'string',format:'date-time'},actor:{type:'string'}}}}}},
  warnings:{type:'array',items:{type:'string'}},createdAt:{type:'string',format:'date-time'},acknowledgement:{type:'string'},
  review:{type:'object',required:['areaRevision','packageRevision','inputFingerprint','findings','coverage'],properties:{
    areaRevision:{type:'integer'},packageRevision:{type:'integer'},inputFingerprint:{type:'string'},
    findings:{type:'array',items:finding},coverage:{type:'array',items:{type:'string'}}}},
}};

const xy = { type:'array', minItems:2, maxItems:2, items:{type:'number'} };
const geometry = {type:'object',required:['type','coordinates'],properties:{
  type:{type:'string',enum:['Point','LineString','Polygon','MultiPolygon']},
  coordinates:{oneOf:[xy,{type:'array',items:xy},{type:'array',items:{type:'array',items:xy}},
    {type:'array',items:{type:'array',items:{type:'array',items:xy}}}]},
}};
export const spatialSnapshot = {type:'object',required:['schemaVersion','id','revision','worldId','worldState','frames','sources','entities','representations','relations','attachments'],properties:{
  schemaVersion:{type:'string',enum:['ulpin-spatial/1']},id:{type:'string'},revision:{type:'integer'},worldId:{type:'string'},
  worldState:{type:'string',enum:['observed','planned','hypothetical','synthetic']},
  frames:{type:'array',items:{type:'object',required:['id','kind','horizontalUnit','verticalUnit','axes','verticalReference'],properties:{
    id:{type:'string'},kind:{type:'string',enum:['engineering','geographic']},horizontalUnit:{type:'string',enum:['m','degree']},
    verticalUnit:{type:'string',enum:['m']},axes:{type:'string',enum:['east-north-up','longitude-latitude-height']},
    verticalReference:{type:'string',nullable:true},sourceCrs:{type:'string'},
    anchor:{type:'object',required:['longitude','latitude','ellipsoidHeight','provenance'],properties:{
      longitude:{type:'number'},latitude:{type:'number'},ellipsoidHeight:{type:'number'},provenance:{type:'string'}}},
  }}},
  sources:{type:'array',items:{type:'object',required:['id','revision','label','method'],properties:{
    id:{type:'string'},revision:{type:'integer',nullable:true},label:{type:'string'},
    method:{type:'string',enum:['source','manual','derived','synthetic']},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
  }}},
  entities:{type:'array',items:{type:'object',required:['id','revision','worldId','kind','label','identifiers','areaIds','representationIds'],properties:{
    id:{type:'string'},revision:{type:'integer'},worldId:{type:'string'},kind:{type:'string'},label:{type:'string'},
    identifiers:{type:'array',items:{type:'object',required:['scheme','issuer','value','status'],properties:{
      scheme:{type:'string'},issuer:{type:'string'},value:{type:'string'},status:{type:'string',enum:['supplied','validated','prototype']}}}},
    areaIds:{type:'array',items:{type:'string'}},representationIds:{type:'array',items:{type:'string'}},
  }}},
  representations:{type:'array',items:{type:'object',required:['id','revision','entityId','frameId','role','geometry','vertical','evidence'],properties:{
    id:{type:'string'},revision:{type:'integer'},entityId:{type:'string'},frameId:{type:'string'},role:{type:'string'},
    geometry,vertical:{type:'object',nullable:true,required:['lower','upper','reference'],properties:{
      lower:{type:'number'},upper:{type:'number'},reference:{type:'string'}}},
    evidence:{type:'array',items:{type:'object',required:['sourceId','sourceRevision','locator'],properties:{
      sourceId:{type:'string'},sourceRevision:{type:'integer',nullable:true},
      locator:{type:'object',required:['kind','value'],properties:{kind:{type:'string'},value:{type:'string'}}}}}},
    appearance:{type:'object',properties:{facade:{type:'string',enum:['plain','schematic']},storeys:{type:'integer'},
      roof:{type:'string',enum:['flat','terrace']},envelopeOnly:{type:'boolean'}}},
  }}},
  relations:{type:'array',items:{type:'object',required:['id','fromId','toId','kind'],properties:{
    id:{type:'string'},fromId:{type:'string'},toId:{type:'string'},kind:{type:'string'}}}},
  attachments:{type:'array',items:{type:'object',required:['id','entityId','sourceId','sourceRevision','purpose'],properties:{
    id:{type:'string'},entityId:{type:'string'},sourceId:{type:'string'},sourceRevision:{type:'integer',nullable:true},
    purpose:{type:'string',enum:['context','geometry','record']}}}},
}};
export const legacyAreaProjection = {type:'object',required:['snapshot','diagnostics'],properties:{
  snapshot:spatialSnapshot,diagnostics:{type:'array',items:{type:'object',required:['entityId','code','message'],properties:{
    entityId:{type:'string'},code:{type:'string'},message:{type:'string'}}}},
}};
export const neighbourhoodView = {type:'object',required:['schemaVersion','areaId','name','world','readDigest','snapshot','items','sourceCount','documentCount','notices','attributions','publicationId','manifestUrl'],properties:{
  schemaVersion:{type:'string',enum:['ulpin-neighbourhood-view/1']},areaId:{type:'string',format:'uuid'},name:{type:'string'},
  world:{type:'string',enum:['observed','planned','hypothetical','synthetic']},readDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
  snapshot:spatialSnapshot,items:{type:'array',items:{type:'object',required:['id','canonicalRef','revision','label','kind','identifier','sourceRepresentationId','analyticalRepresentationId','height','heightState','horizontalArea','prismVolume','quantityReason','sourceCount','recordId','hasPlacedInteriors','renderStatus'],properties:{
    id:{type:'string'},canonicalRef:{type:'object',required:['namespace','id'],properties:{namespace:{type:'string'},id:{type:'string'}}},
    revision:{type:'integer'},label:{type:'string'},kind:{type:'string'},identifier:{type:'string'},
    sourceRepresentationId:{type:'string'},analyticalRepresentationId:{type:'string',nullable:true},
    height:{type:'number',nullable:true},heightState:{type:'string'},horizontalArea:{type:'number',nullable:true},
    prismVolume:{type:'number',nullable:true},quantityReason:{type:'string',nullable:true},
    sourceCount:{type:'integer'},recordId:{type:'string',nullable:true},hasPlacedInteriors:{type:'boolean'},
    renderStatus:{type:'string',enum:['massing','footprint','alignment','surface']},
  }}},sourceCount:{type:'integer'},documentCount:{type:'integer'},
  notices:{type:'array',items:{type:'string'}},attributions:{type:'array',items:{type:'string',enum:['google','osm']}},
  publicationId:{type:'string',pattern:'^[a-f0-9]{64}$'},manifestUrl:{type:'string'},
}};
export const externalScene = {type:'object',required:['geometryMetadata','areaId','featureId','featureRevision','source','scene'],properties:{
  geometryMetadata:{type:'object',required:['representation','geometryClass','analyticEligible','semanticLod','displayLevel','qualification'],properties:{
    representation:{type:'string',enum:['physical_semantic']},geometryClass:{type:'string',enum:['evidence_linked']},
    analyticEligible:{type:'boolean',enum:[false]},semanticLod:{type:'string'},displayLevel:{type:'integer',nullable:true,description:'Null for this source semantic exterior profile'},
    qualification:{type:'object',required:['state','reasons'],properties:{state:{type:'string',enum:['unqualified']},reasons:{type:'array',items:{type:'string'}}}},
  }},
  areaId:{type:'string',format:'uuid'},featureId:{type:'string',format:'uuid'},featureRevision:{type:'integer'},
  source:{type:'object',required:['id','revision','sha256','bytes'],properties:{
    id:{type:'string',format:'uuid'},revision:{type:'integer'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},bytes:{type:'integer'}}},
  scene:{type:'object',description:'Bounded retained CityJSON semantic exterior, decoded from the exact source original',
    required:['schemaVersion','sourceBuildingId','partIds','referenceSystem','frame','vertices','faces','bounds','lod','interiors','analyticalVolume'],properties:{
      schemaVersion:{type:'string',enum:['usp-external-roof/1']},sourceBuildingId:{type:'string'},partIds:{type:'array',items:{type:'string'}},
      referenceSystem:{type:'string'},frame:{type:'object',required:['kind','origin','unit','verticalDatum','globalPlacement'],properties:{
        kind:{type:'string',enum:['local_engineering_display']},origin:{type:'array',minItems:3,maxItems:3,items:{type:'number'}},
        unit:{type:'string',enum:['m']},verticalDatum:{type:'string',enum:['NAP']},globalPlacement:{type:'string',enum:['unqualified']}}},
      vertices:{type:'array',items:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}},
      faces:{type:'array',items:{type:'object',required:['partId','sourceFaceIndex','semanticIndex','surfaceType','indices','rings','triangles','normal'],properties:{
        partId:{type:'string'},sourceFaceIndex:{type:'integer'},semanticIndex:{type:'integer',nullable:true},
        surfaceType:{type:'string',nullable:true},indices:{type:'array',items:{type:'integer'}},
        rings:{type:'array',items:{type:'array',items:{type:'integer'}}},triangles:{type:'array',items:{type:'integer'}},
        normal:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}}}},
      bounds:{type:'object',required:['minimum','maximum'],properties:{
        minimum:{type:'array',minItems:3,maxItems:3,items:{type:'number'}},
        maximum:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}}},
      lod:{type:'string',enum:['2.2']},interiors:{type:'string',enum:['unavailable']},
      analyticalVolume:{type:'string',enum:['unsupported']},
    }},
}};
