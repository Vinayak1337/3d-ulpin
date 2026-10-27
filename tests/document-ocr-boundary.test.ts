import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {admitOcrCandidate,privateOcrDirectory,
  readBoundedOcrArtifact} from '../packages/server/src/modules/usp/ingestion/document-ocr';
import {DocumentOcrSchema,DocumentStatusSchema} from '../packages/contracts/src/usp/document-ingestion';

test('large OCR source frames require bounded crops in results and status summaries',()=>{
  const value={sourceSha256:'a'.repeat(64),sourceRevision:1,sourcePage:1,requestedRegion:[2400,1500,2580,1600],
    sourcePageFrame:{kind:'pdf_display_page_top_left_points',rotation:0,width:2586,height:1694},
    method:'ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned',toolStatus:'complete',outputStatus:'partial',
    textCompleteness:'unverified',issues:[],items:[{text:'technical-control',label:'text',
      method:'ocr:docling-tesseract-cli-full-page',sourcePageBoxes:[{pageNumber:1,frame:'pdf_display_page_top_left_points',
        box:[2410,1510,2500,1550],derivedFrom:'docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin'}]}]};
  const statusOcr=DocumentStatusSchema.shape.ocr.unwrap().unwrap();
  assert(DocumentOcrSchema.safeParse(value).success);
  const {items,...summary}=value;assert(statusOcr.safeParse(summary).success);
  for(const change of [{requestedRegion:null},{requestedRegion:[0,0,2001,100]},
    {requestedRegion:[2400,1500,2587,1600]},{requestedRegion:[2400,1500,2400.5,1600]},
    {requestedRegion:[2400,1500,Number.NaN,1600]},
    {sourcePageFrame:{...value.sourcePageFrame,width:14401}},
    {sourcePageFrame:{...value.sourcePageFrame,rotation:90}}]){
    assert.equal(DocumentOcrSchema.safeParse({...value,...change}).success,false);
    assert.equal(statusOcr.safeParse({...summary,...change}).success,false);
  }
  assert(DocumentOcrSchema.safeParse({...value,sourcePageFrame:{...value.sourcePageFrame,width:14400,height:14400},
    requestedRegion:[12400,12400,14400,14400],items:[]}).success);
});

test('sparse OCR cites TSV pixel boxes and cannot be relabelled as Docling',()=>{
  const value={sourceSha256:'a'.repeat(64),sourceRevision:1,sourcePage:1,requestedRegion:null,
    sourcePageFrame:{kind:'pdf_display_page_top_left_points',rotation:0,width:100,height:100},
    method:'ocr:tesseract-cli-5.5.1:sparse-tsv-v1',toolStatus:'complete',outputStatus:'partial',
    textCompleteness:'unverified',issues:['low_confidence_words_withheld'],items:[{text:'001 TITLE',label:'text',
      method:'ocr:tesseract-cli-sparse-tsv',sourcePageBoxes:[{pageNumber:1,frame:'pdf_display_page_top_left_points',
        box:[1,2,40,8],derivedFrom:'tesseract_tsv_pixels_via_mupdf_pixel_origin'}]}]};
  assert(DocumentOcrSchema.safeParse(value).success);
  assert.equal(DocumentOcrSchema.safeParse({...value,method:'ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned'}).success,false);
  assert.equal(DocumentOcrSchema.safeParse({...value,items:[{...value.items[0],sourcePageBoxes:[{
    ...value.items[0].sourcePageBoxes[0],derivedFrom:'docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin'}]}]}).success,false);
});

// The region, render scale and page frame of the site plan in R5c's finding F1, and its three boxes as the
// worker read them (docs/evidence/gf1/k9d/step0.json). The render starts at whole pixel 227, 1.114 pt outside.
const site={region:[280,860,960,2580] as [number,number,number,number],scale:0.813953488372093,
  frame:{kind:'pdf_display_page_top_left_points' as const,rotation:0 as const,width:2585,height:3390}};
const f1Boxes=[[278.8857142857143,1041.8513,293.63041428571427,1046.7662],
  [278.8857142857143,1117.2131,293.63041428571427,1174.5536],
  [278.8857142857143,1325.2772,280.52401428571426,1353.1282999999999]];
const f1Overhang=280-278.8857142857143,inside=[300,900,340,920],pastOnePixel=[278.7,900,340,920];
const doclingMethod='ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned';
const line=(box:number[])=>({text:'technical-control',label:'text',method:'ocr:docling-tesseract-cli-full-page',
  sourcePageBoxes:[{pageNumber:1,frame:'pdf_display_page_top_left_points',box,
    derivedFrom:'docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin'}]});
const regionResult=(boxes:number[][],regionEdge?:Record<string,number>)=>({sourceSha256:'a'.repeat(64),
  sourceRevision:1,sourcePage:1,requestedRegion:site.region,sourcePageFrame:site.frame,method:doclingMethod,
  toolStatus:'complete',outputStatus:'partial',textCompleteness:'unverified',issues:[],items:boxes.map(line),
  ...(regionEdge?{regionEdge}:{})});
const edge=(boxesBeyondRegion:number,largestOverhangPt:number,renderScalePxPerPt=site.scale)=>
  ({renderScalePxPerPt,boxesBeyondRegion,largestOverhangPt});

test('without a stated region edge the first 1 pt box rule is unchanged',()=>{
  assert.equal(Number(f1Overhang.toFixed(6)),1.114286);
  for(const boxes of [[inside],[[279,900,340,920]],[[300,900,961,2581]]])
    assert(DocumentOcrSchema.safeParse(regionResult(boxes)).success);
  const refused=DocumentOcrSchema.safeParse(regionResult(f1Boxes));
  assert.deepEqual(refused.error?.issues.map(issue=>issue.message),
    ['OCR boxes must stay in the selected source region.']);
  assert.equal(DocumentOcrSchema.safeParse(regionResult([[278.999,900,340,920]])).success,false);
});

test('a stated render scale allows one rendered pixel and the contract recounts the boxes',()=>{
  const kept=DocumentOcrSchema.parse(regionResult([...f1Boxes,inside],edge(3,f1Overhang)));
  assert.deepEqual(kept.items.map(item=>item.sourcePageBoxes[0].box),[...f1Boxes,inside]);
  assert.deepEqual(kept.regionEdge,edge(3,f1Overhang));
  assert(DocumentOcrSchema.safeParse(regionResult([inside],edge(0,0))).success);
  assert(DocumentOcrSchema.safeParse(regionResult(f1Boxes,edge(3,1.114286))).success);
  const statusOcr=DocumentStatusSchema.shape.ocr.unwrap().unwrap(),{items,...summary}=kept;
  assert.equal(items.length,4);assert(statusOcr.safeParse(summary).success);
  // Miscounted, misstated, further out than one pixel, or a scale that would allow more than 2 pt.
  for(const [boxes,stated] of [[f1Boxes,edge(2,f1Overhang)],[f1Boxes,edge(3,1.2)],[f1Boxes,edge(0,0)],
    [[pastOnePixel],edge(1,1.3)],[[inside],edge(0,0,0.49)],[[inside],edge(1,0.5)]] as const)
    assert.equal(DocumentOcrSchema.safeParse(regionResult([...boxes.map(box=>[...box])],stated)).success,false);
  // At 3 px per pt one pixel is a third of a point: the stated scale narrows the rule as well as widening it.
  assert.equal(DocumentOcrSchema.safeParse(regionResult([[279.5,900,340,920]],edge(1,0.5,3))).success,false);
  assert(DocumentOcrSchema.safeParse(regionResult([[279.7,900,340,920]],edge(1,280-279.7,3))).success);
  const wholePage={...regionResult([]),requestedRegion:null,sourcePageFrame:{...site.frame,width:100,height:100},
    method:'ocr:tesseract-cli-5.5.1:sparse-tsv-v1'};
  assert(DocumentOcrSchema.safeParse(wholePage).success);
  assert.equal(DocumentOcrSchema.safeParse({...wholePage,regionEdge:edge(0,0)}).success,false);
});

test('the bridge keeps a box within one rendered pixel as read, counts it, and names one further out',()=>{
  const input={jobId:randomUUID(),sourceSha256:'a'.repeat(64),sourceRevision:1,sourceBytes:1,
    ocrSelection:{page:1,region:site.region}};
  const worker=(boxes:number[][],render?:{scale:number})=>Buffer.from(JSON.stringify({
    schemaVersion:'source-ocr-candidate/1',sourceSha256:input.sourceSha256,sourceBytes:1,sourcePage:1,
    sourcePageFrame:site.frame,selection:{kind:'selected_region',sourcePageBox:site.region,
      textCompleteness:'unverified'},method:doclingMethod,toolStatus:'complete',outputStatus:'partial',issues:[],
    items:boxes.map(line),...(render?{render}:{})}));
  const stated={scale:site.scale};
  const kept=admitOcrCandidate(input,worker([...f1Boxes,inside],stated));
  assert.equal(kept.toolStatus,'complete');assert.deepEqual(kept.regionEdge,edge(3,f1Overhang));
  assert.deepEqual(kept.items.map(item=>item.sourcePageBoxes[0].box),[...f1Boxes,inside]);
  assert.deepEqual(admitOcrCandidate(input,worker([inside],stated)).regionEdge,edge(0,0));
  // Further out than one rendered pixel, or 1.114 pt out with no scale stated by the worker: refused by name.
  for(const refused of [admitOcrCandidate(input,worker([inside,pastOnePixel],stated)),
    admitOcrCandidate(input,worker(f1Boxes))]){
    assert.equal(refused.toolStatus,'failed');assert.equal(refused.outputStatus,'failed');
    assert.deepEqual(refused.issues,['OCR_BOX_OUTSIDE_REGION']);assert.deepEqual(refused.items,[]);
    assert.equal(refused.regionEdge,undefined);
  }
  // The bridge never guesses a scale: without one it states no edge and the 1 pt rule decides.
  const unscaled=admitOcrCandidate(input,worker([[279.5,900,340,920]]));
  assert.equal(unscaled.toolStatus,'complete');assert.equal(unscaled.regionEdge,undefined);
});

test('OCR artifact over the cap is refused; bounded bytes remain exact',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ulpin-ocr-byte-control-'));
  try{
    const path=join(dir,'technical-control.bin');await writeFile(path,Buffer.alloc(17));
    await assert.rejects(()=>readBoundedOcrArtifact(path,16),/OCR_ARTIFACT_LIMIT/);
    const bytes=Buffer.from([0,255,13,10]);await writeFile(path,bytes);
    assert.deepEqual(await readBoundedOcrArtifact(path,16),bytes);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Windows OCR attempt directory grants only the current account before source write',
  {skip:process.platform!=='win32'},async()=>{
    const scratch=await mkdtemp(join(tmpdir(),'ulpin-ocr-acl-control-'));
    try{
      const dir=await privateOcrDirectory(scratch,randomUUID());
      const command=`$ErrorActionPreference='Stop'; $acl=[System.IO.Directory]::GetAccessControl('${dir.replaceAll("'","''")}'); `+
        '$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; '+
        '@{protected=$acl.AreAccessRulesProtected;identity=$identity;rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object {'+
        '@{sid=$_.IdentityReference.Value;'+
        'inherited=$_.IsInherited;type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString()}})} | ConvertTo-Json -Compress';
      const value=JSON.parse(execFileSync(join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:10000}));
      assert.equal(value.protected,true);assert.equal(value.rules.length,1);
      assert.equal(value.rules[0].sid,value.identity);assert.equal(value.rules[0].inherited,false);
      assert.equal(value.rules[0].type,'Allow');assert(value.rules[0].rights.includes('FullControl'));
    }finally{await rm(scratch,{recursive:true,force:true});}
  });
