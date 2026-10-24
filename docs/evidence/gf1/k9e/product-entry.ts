// K9e: the Tower 3 plan through the product's own pages read (DocumentPagesService with its real worker), on a
// scratch copy: the listing, then the picture, as the Studio asks for them. No database, no demo, CPU only.
// The source identity is supplied here in place of the database lookup; everything after it is the product.
// Run under the guard, which keeps .env files and the runtime folder closed and retains the attempt folders:
//   G=E:/Projects/ulpin-wt/f1/docs/evidence/gf1/k9e/safety.cjs
//   NODE_OPTIONS="--require $G" node --require $G --import tsx docs/evidence/gf1/k9e/product-entry.ts
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';

const data='E:/BhuAayam-data',scratch=`${data}/task-data/k9e`;
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const original=readFileSync(`${scratch}/input/haryana-2831-tower3-plan1.pdf`),sourceSha256=sha(original);
if(sourceSha256!=='2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865')throw new Error('wrong copy');
mkdirSync(`${scratch}/pages-scratch`,{recursive:true});mkdirSync(`${scratch}/product-entry`,{recursive:true});
Object.assign(process.env,{ULPIN_DOCUMENT_PAGES_SCRATCH:`${scratch}/pages-scratch`,
  ULPIN_DOCUMENT_PAGES_PYTHON:`${data}/ml/venv-demo-documents-20261010/Scripts/python.exe`});

const {DocumentPagesService,inspectPrivateDocumentPages}=
  await import('../../../../packages/server/src/modules/usp/ingestion/document-pages');
const sourceId='5293cd72-2377-4deb-a51c-c76d11ccb429';
const authority={caseId:'00000000-0000-4000-8000-000000000000',caseRevision:1,sourceId,sourceRevision:1,
  sourceSha256,sourceBytes:original.length,objectKey:'scratch-copy',name:'haryana-2831-tower3-plan1.pdf',
  authoritySha256:sha(Buffer.from('k9e scratch copy'))};
const service=new DocumentPagesService({authorize:async()=>authority,original:async()=>original,
  inspect:inspectPrivateDocumentPages});
const pin={revision:'1',sha256:sourceSha256};
let started=Date.now();
const listing=await service.pages(sourceId,{...pin,offset:'0',limit:'1'}),listingMs=Date.now()-started;
started=Date.now();
const picture=await service.raster(sourceId,1,pin),pictureMs=Date.now()-started;
const kept=`${scratch}/product-entry/page-1-${started}.png`;
writeFileSync(kept,picture.bytes,{flag:'wx'});
const summary={file:authority.name,sourceSha256,page:1,python:process.env.ULPIN_DOCUMENT_PAGES_PYTHON,
  listing:{page:listing.pages[0],ms:listingMs},
  picture:{frame:picture.frame,render:picture.render,pngBytes:picture.bytes.length,pngSha256:sha(picture.bytes),
    header:picture.render.reduced?'X-Page-View: reduced':null,kept,ms:pictureMs}};
writeFileSync(`${scratch}/product-entry/product-entry-${started}.json`,JSON.stringify(summary)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
