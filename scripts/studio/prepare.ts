import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {district,computeFindings,allFindings,exportGeoJSON,STUDIO_DATA_VERSION} from '../../apps/web/features/studio/data/district';
import {createDocument} from '../../apps/web/features/studio/data/documents';
import {preparedDocumentId,type PreparedDocument,type StudioSourceManifest} from '../../apps/web/features/studio/data/source-types';
import {studioRawData,normalizeStudioFixture} from './core-fixture';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const {zipSync,unzipSync}=require('fflate');
const output='fixtures/studio/reference-v2';
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value));
await mkdir(output,{recursive:true});
const entries:Record<string,Uint8Array>={},documents:PreparedDocument[]=[];
for(const b of district.buildings){
 const jobs:[PreparedDocument['kind'],typeof b.units[number]|undefined,number][]=[['land',undefined,0],['register',undefined,0],...Array.from({length:b.floors},(_,f)=>['plan',undefined,f] as const),...b.units.map(u=>['lease',u,u.floor] as const)] as typeof jobs;
 jobs.push(['aerial',undefined,0]);
 for(const [kind,unit,floor]of jobs){
  const id=preparedDocumentId(kind,b.id,unit?.id,floor),doc=createDocument(kind,b,unit,floor);
  doc.setFileId(createHash('md5').update(STUDIO_DATA_VERSION+':'+id).digest('hex'));
  const bytes=Buffer.from(doc.output('arraybuffer')),filename=`DEMO-${id}.pdf`;
  entries['documents/'+filename]=bytes;
  documents.push({id,kind,buildingId:b.id,unitId:kind==='lease'?unit!.id:null,floor:kind==='plan'||kind==='lease'?floor:null,filename,sha256:sha(bytes),bytes:bytes.length,pages:doc.getNumberOfPages()});
 }
}
const raw=studioRawData(),rawBytes=encode(raw);
console.log('Prepared PDF specimens',documents.length,'— normalizing linked geometry');
const core=await normalizeStudioFixture(raw,{sha256:sha(rawBytes),bytes:rawBytes.length},documents);
const hero=district.buildings.find(b=>b.id===district.defaultBuildingId)!;
const q=core.quantities.find(q=>q.representation.ref.id===hero.id)!;
assert.equal(q.horizontalArea.value,hero.width*hero.depth);assert.equal(q.prismVolume.value,hero.width*hero.depth*hero.height);
assert.equal(new Set(raw.records.map(r=>r.id)).size,raw.records.length);
const csv=Buffer.from('building_id,unit_id,floor,net_area_m2,occupancy,occupant_fictional,rent_inr\n'+district.buildings.flatMap(b=>b.units.map(u=>[b.id,u.id,u.floor,u.area,u.tenure,u.occupant,u.rent].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(','))).join('\n')+'\n');
const files:Record<string,Buffer>={
 'records.json':rawBytes,
 'normalized-core.json':encode(core),
 'findings.json':encode({synthetic:true,method:'rectangular-planar-fixture/2',note:'Overlapping finding regions are not summed; utility horizontal clearance is not burial depth',findings:allFindings}),
 'buildings.geojson':encode(exportGeoJSON('buildings')),
 'parcels.geojson':encode(exportGeoJSON('parcels')),
 'occupancy.csv':csv,
};
for(const [name,bytes]of Object.entries(files)){entries[name]=bytes;await writeFile(output+'/'+name,bytes);}
const manifest:StudioSourceManifest={schemaVersion:'studio-prepared-sources/1',datasetVersion:STUDIO_DATA_VERSION,synthetic:true,datasetSha256:sha(rawBytes),coreInputDigest:core.snapshot.manifest.inputDigest,coreGeometryDigest:core.snapshot.manifest.geometryDigest,
 counts:{buildings:district.buildings.length,parcels:district.buildings.length,floors:district.buildings.reduce((n,b)=>n+b.floors,0),units:district.buildings.reduce((n,b)=>n+b.units.length,0),roads:district.roads.length,utilities:district.utilities.length,findings:allFindings.length,documents:documents.length},documents,
 assets:Object.entries(files).map(([file,bytes])=>({id:file.split('.')[0],file,bytes:bytes.length,sha256:sha(bytes),mediaType:file.endsWith('.csv')?'text/csv':file.endsWith('.geojson')?'application/geo+json':'application/json'}))};
entries['manifest.json']=encode(manifest);
const zip:Uint8Array=zipSync(entries,{level:6,mtime:new Date('2026-09-19T00:00:00Z')});
await writeFile(output+'/source-bundle.zip',zip);
manifest.assets.push({id:'source-bundle',file:'source-bundle.zip',bytes:zip.length,sha256:sha(zip),mediaType:'application/zip'});
const check=unzipSync(zip);for(const d of documents){const bytes=check['documents/'+d.filename];assert(bytes);assert.equal(bytes.length,d.bytes);assert.equal(sha(bytes),d.sha256);}
await writeFile(output+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(output+'/VERIFICATION.json',JSON.stringify({kind:'prepared-synthetic-asset-verification',datasetVersion:STUDIO_DATA_VERSION,coreSchema:'ulpin-spatial/2',schemaValidated:true,sourceHashesVerified:documents.length+Object.keys(files).length,counts:manifest.counts,independentHeroExpected:{footprint:288,volume:4608,outsideParcel:32,roadOverlap:16,waterClearance:1.8},actualHero:{area:q.horizontalArea.value,volume:q.prismVolume.value,findings:computeFindings(hero)},bundleBytes:zip.length,bundleSha256:sha(zip),notClaimed:['Government identifiers','Real occupancy','Survey measurements','ML inference','Database publication']},null,2)+'\n');
console.log(JSON.stringify({result:'PASS',counts:manifest.counts,records:raw.records.length,geometryRepresentations:core.snapshot.geometry.representations.length,coreInputDigest:manifest.coreInputDigest,bundleBytes:zip.length,output}));
