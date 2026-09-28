/** Pin the existing Lake View showcase inputs. Does not write production registry records. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const destination=process.argv[2];
if(!destination)throw new Error('Pass a private bootstrap JSON destination.');
const data=join(root,'apps/studio/datasets');
const context=JSON.parse(await readFile(join(root,'apps/studio/src/local/data/lake-view/context.json'),'utf8'));
const register=JSON.parse(await readFile(join(root,'apps/studio/src/local/data/lake-view/register.json'),'utf8'));
const floorsFiles=['deed_of_declaration.pdf','levels.csv','plan_F7.pdf','sale_deed_704.pdf','unit_inventory.csv'];
const names=['1-area/lake_view_survey.geojson',...floorsFiles.map(name=>'2-building/'+name)];
const sources=[];
for(const name of names){const bytes=await readFile(join(data,name));sources.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const revision=createHash('sha256').update(JSON.stringify(sources)).digest('hex');
let previous;try{previous=JSON.parse(await readFile(destination,'utf8'))}catch{}
if(previous?.revision===revision){console.log('Existing Lake View bootstrap preserved.');process.exit(0);}
const now=Date.now();
const value={version:1,revision,createdAt:new Date(now).toISOString(),classification:'Existing sample property workflow',
  areaId:context.area.id,buildingId:register.property.id,featureCount:context.features.length,registerCount:register.register.length,sources,
  session:{areaStartedAt:now,floorsStartedAt:now,areaPackageId:randomUUID(),floorsImportId:randomUUID(),floorsFiles,deletedBuildings:[]}};
await mkdir(dirname(destination),{recursive:true,mode:0o700});
await writeFile(destination,JSON.stringify(value,null,2)+'\n',{mode:0o600});
console.log(`Lake View ready: ${context.features.length} features, ${register.register.length} register entries, ${sources.length} retained input files.`);
