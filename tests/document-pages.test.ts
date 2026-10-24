import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {DocumentPagesService,documentPageAuthorityTx,type DocumentPageAuthority} from '../packages/server/src/modules/usp/ingestion/document-pages';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {DocumentPagesQuerySchema} from '../packages/contracts/src/document-pages';

// In-memory transport/authority controls, never operational sources or SQL rows.
const sourceId='174da4ed-bb83-4726-bd2d-d3f53578de11',caseId='b4d629b1-b948-4ba6-900b-28e4c2bf2458';
const original=Buffer.from('in-memory page authority byte control'),hash=sha256(original);
const pin={revision:'1',sha256:hash};
const authority:DocumentPageAuthority={caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:hash,
  sourceBytes:original.length,objectKey:'technical-only',name:'Technical control',authoritySha256:'1'.repeat(64)};
const page={page:1,label:'Page 1',sourceLabel:null,frame:{kind:'pdf_display_page_top_left_points' as const,rotation:0,width:612,height:792},
  mediaBox:[0,0,612,792] as [number,number,number,number],cropBox:[0,0,612,792] as [number,number,number,number],
  boxConvention:'pymupdf_page_rectangles/1' as const,renderSupport:'supported' as const};
const metadata={version:'document-pages-local/1' as const,sourceSha256:hash,sourceBytes:original.length,
  pageCount:1,offset:0,limit:25,pages:[page],render:null};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const rendered={...metadata,limit:1,render:{page:1,sha256:sha256(png),bytes:png.length,pixels:[1,1] as [number,number],scale:1,pixelOrigin:[0,0] as [number,number],dpi:[72,72] as [number,number]}};
const error=(status:number,code:string)=>(value:unknown)=>value instanceof AppError&&value.status===status&&value.code===code;
function service(overrides:Partial<ConstructorParameters<typeof DocumentPagesService>[0]>={}){
  return new DocumentPagesService({authorize:async()=>structuredClone(authority),original:async()=>original,
    inspect:async(_a,_b,selection)=>({result:selection.page?structuredClone(rendered):structuredClone(metadata),...(selection.page?{png}: {})}),...overrides});
}

test('page authority reuses canonical original subject/case/family checks and exact current pins',async()=>{
  const oldSubject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='pages-technical-operator';
  let archived=false,latest=1,subject='pages-technical-operator';
  const client={query:async(sql:string)=>{
    if(sql.startsWith('SELECT case_id FROM sources'))return {rows:[{case_id:caseId}]};
    if(sql.startsWith('SELECT id,revision,archived'))return {rows:[{id:caseId,revision:1,archived,frame:{id:'UNASSIGNED'},context:[],site_id:null}]};
    if(sql.startsWith('SELECT * FROM sources'))return {rows:[{id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'Technical control',bytes:String(original.length),sha256:hash,object_key:'technical-only',
      inspection:{documentOriginal:{version:'source-document/1',format:'pdf',subject,bytes:original.length,sha256:hash,receivedAt:'2026-10-01T00:00:00Z'}}}]};
    if(sql.startsWith('SELECT max(revision)'))return {rows:[{revision:latest}]};
    throw new Error('Unexpected authority SQL');
  }} as unknown as PoolClient;
  try{
    const result=await documentPageAuthorityTx(client,sourceId,{revision:1,sha256:hash});
    assert.equal(result.sourceId,sourceId);assert.equal(result.caseId,caseId);assert.equal(result.objectKey,'technical-only');
    latest=2;await assert.rejects(documentPageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(409,'STALE_REVISION'));latest=1;
    await assert.rejects(documentPageAuthorityTx(client,sourceId,{revision:2,sha256:hash}),error(409,'STALE_REVISION'));
    subject='different-private-subject';await assert.rejects(documentPageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(403,'DOCUMENT_DENIED'));subject='pages-technical-operator';
    archived=true;await assert.rejects(documentPageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(403,'DOCUMENT_DENIED'));
  }finally{if(oldSubject===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=oldSubject;}
});

test('exact page projection has private pinned URLs, source dimensions and null calibration only',async()=>{
  let checks=0;const s=service({authorize:async()=>{checks++;return authority;}}),result=await s.pages(sourceId,pin);
  assert.equal(checks,3);assert.equal(result.pages[0].calibration,null);assert.deepEqual(result.pages[0].frame,page.frame);
  assert.equal(result.pages[0].url,`/api/v1/sources/${sourceId}/pages/1/raster?revision=1&sha256=${hash}`);
  assert.deepEqual(result.anchors,[{locator:'page:1',page:1,region:null}]);assert(!JSON.stringify(result).includes('technical-only'));
});

test('post-original and post-render drift or revoked access deny publication',async()=>{
  for(const driftAt of [2,3]){let checks=0,rendered=false;
    const s=service({authorize:async()=>++checks===driftAt?{...authority,authoritySha256:'2'.repeat(64)}:authority,
      inspect:async()=>{rendered=true;return {result:metadata};}});
    await assert.rejects(s.pages(sourceId,pin),error(409,'STALE_REVISION'));assert.equal(rendered,driftAt===3);
  }
  let checks=0;
  await assert.rejects(service({authorize:async()=>{if(++checks===3)throw new AppError(403,'DOCUMENT_DENIED','Technical revocation');return authority;}}).raster(sourceId,1,pin),error(403,'DOCUMENT_DENIED'));
});

test('wrong page, incomplete pins and caller path/URL fields never reach parsing',async()=>{
  let parsed=false;const s=service({inspect:async()=>{parsed=true;return {result:metadata};}});
  for(const p of [0,401])await assert.rejects(s.raster(sourceId,p,pin));
  await assert.rejects(s.pages(sourceId,{...pin,path:'C:/caller.pdf'}));await assert.rejects(s.pages(sourceId,{...pin,url:'https://caller.invalid/file.pdf'}));
  await assert.rejects(s.pages(sourceId,{revision:'1'}));assert.equal(parsed,false);
  assert.equal(DocumentPagesQuerySchema.safeParse({...pin,limit:'51'}).success,false);
});

test('original corruption and raster byte/pixel/selection drift fail before publication',async()=>{
  await assert.rejects(service({original:async()=>Buffer.from('changed')}).pages(sourceId,pin),error(422,'DOCUMENT_PAGES_SOURCE_INTEGRITY'));
  await assert.rejects(service({inspect:async()=>({result:{...rendered,render:{...rendered.render,page:2}},png})}).raster(sourceId,1,pin),error(503,'DOCUMENT_PAGES_RESULT_INTEGRITY'));
  await assert.rejects(service({inspect:async()=>({result:{...rendered,render:{...rendered.render,pixels:[1400,1400]}},png})}).raster(sourceId,1,pin),error(503,'DOCUMENT_PAGES_RESULT_INTEGRITY'));
  const valid=await service().raster(sourceId,1,pin);assert.deepEqual(valid.bytes,png);
});

test('one local parse/render at a time; a completed failure releases the slot',async()=>{
  let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r);
  const s=service({inspect:async()=>{started();await hold;return {result:metadata};}});
  const pending=s.pages(sourceId,pin);await ready;
  await assert.rejects(service().pages(sourceId,pin),error(429,'DOCUMENT_PAGES_BUSY'));release();await pending;
  await assert.rejects(service({inspect:async()=>{throw new AppError(422,'DOCUMENT_PAGE_NOT_FOUND','Technical invalid selection');}}).pages(sourceId,pin),error(422,'DOCUMENT_PAGE_NOT_FOUND'));
  assert.equal((await service().pages(sourceId,pin)).pageCount,1);
});

const rasterUrl=`/api/v1/sources/${sourceId}/pages/1/raster?revision=1&sha256=${hash}`;
const large={...page,frame:{...page.frame,width:2586,height:1695},
  mediaBox:[0,0,2586,1695] as [number,number,number,number],cropBox:[0,0,2586,1695] as [number,number,number,number],
  renderSupport:'reduced' as const,reducedScalePxPerPt:0.5413766434648105};
const largeListed={...metadata,pages:[large]};
const largeDrawn={...largeListed,limit:1,
  render:{...rendered.render,scale:large.reducedScalePxPerPt,reduced:true as const}};
const integrity=error(503,'DOCUMENT_PAGES_RESULT_INTEGRITY');

test('a page over the whole-page limit is listed as reduced with its scale and a url, and drawn only as reduced',
  async()=>{
    const s=service({inspect:async(_a,_b,selection)=>selection.page?{result:structuredClone(largeDrawn),png}:
      {result:structuredClone(largeListed)}});
    const listed=(await s.pages(sourceId,pin)).pages[0];
    assert.equal(listed.renderSupport,'reduced');assert.equal(listed.reducedScalePxPerPt,large.reducedScalePxPerPt);
    assert.equal(listed.url,rasterUrl);
    const picture=await s.raster(sourceId,1,pin);
    assert.equal(picture.render.reduced,true);assert.equal(picture.render.scale,listed.reducedScalePxPerPt);
    // Refused: another scale than the listing states, the mark missing, and the mark on a page within the limit.
    for(const result of [{...largeDrawn,render:{...largeDrawn.render,scale:0.5}},
      {...largeDrawn,render:{...rendered.render,scale:large.reducedScalePxPerPt}},
      {...rendered,render:{...rendered.render,reduced:true as const}}])
      await assert.rejects(service({inspect:async()=>({result,png})}).raster(sourceId,1,pin),integrity);
    // A scale without 'reduced', and 'reduced' without a scale, are not a listing.
    const {reducedScalePxPerPt:_scale,...unstated}=large;
    for(const pages of [[{...page,reducedScalePxPerPt:0.5}],[unstated]])
      await assert.rejects(service({inspect:async()=>({result:{...metadata,pages}})}).pages(sourceId,pin),integrity);
  });

test('a page within the limit answers as before; an unsupported page keeps no url and no picture',async()=>{
  const within=await service().pages(sourceId,pin);
  assert.deepEqual(within.pages,[{...page,url:rasterUrl,locator:{kind:'pdf_page',page:1},calibration:null}]);
  assert.deepEqual((await service().raster(sourceId,1,pin)).render,rendered.render);
  const refused={...page,renderSupport:'unsupported' as const};
  const listed=await service({inspect:async()=>({result:{...metadata,pages:[refused]}})}).pages(sourceId,pin);
  assert.equal(listed.pages[0].url,null);assert.equal('reducedScalePxPerPt' in listed.pages[0],false);
  await assert.rejects(service({inspect:async()=>({result:{...rendered,pages:[refused]},png})})
    .raster(sourceId,1,pin),integrity);
});
