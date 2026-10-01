import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {privateOcrDirectory,readBoundedOcrArtifact} from '../packages/server/src/modules/usp/ingestion/document-ocr';
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
