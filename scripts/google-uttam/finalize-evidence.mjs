import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {repositoryEnvironment} from '../repo-env.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const acquisition=resolve(process.argv[2]||'../uttam-nagar-import-20260917');
const out=resolve(process.argv[3]||resolve(acquisition,'evidence/google'));
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const verification=await json(resolve(out,'verification.json'));
assert.equal(verification.result,'PASS');
const hash=b=>createHash('sha256').update(b).digest('hex');
const require=createRequire(resolve(root,'apps/web/package.json'));
const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
const env=repositoryEnvironment(false,root);
const s3=new S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
const manifest=await json(resolve(root,'repo-data/manifest.json'));
const preserved={at:new Date().toISOString(),result:'RUNNING',objects:0};
try{
 for(const item of manifest.objects){
  const response=await s3.send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:item.key}));
  assert.equal(hash(await response.Body.transformToByteArray()),item.sha256,item.key);
  assert.equal(response.ContentType,item.contentType);
  assert.equal(JSON.stringify(Object.entries(response.Metadata||{}).sort()),JSON.stringify(Object.entries(item.metadata||{}).sort()));
  preserved.objects++;
 }
 preserved.result='PASS';console.log(`PASS all ${preserved.objects} original snapshot objects preserved with exact bytes/MIME/metadata`);
}finally{s3.destroy();await writeFile(resolve(out,'original-object-preservation.json'),JSON.stringify(preserved,null,2));}
// Render the actual downloaded register through the installed PDF.js renderer.
const pdfRoot=dirname(require.resolve('pdfjs-dist/package.json'));
const pdfRequire=createRequire(resolve(pdfRoot,'package.json'));
const {createCanvas,DOMMatrix,ImageData,Path2D}=pdfRequire('@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const pdfjs=await import(pathToFileURL(resolve(pdfRoot,'legacy/build/pdf.mjs')).href);
const pdfPath=resolve(out,'Google-UN-A-fictional-register.pdf');
const pdf=await pdfjs.getDocument({data:new Uint8Array(await readFile(pdfPath)),standardFontDataUrl:resolve(pdfRoot,'standard_fonts')+'/',useSystemFonts:true}).promise;
const texts=[];await mkdir(resolve(out,'pdf-preview'),{recursive:true});
for(let i=1;i<=pdf.numPages;i++){
 const page=await pdf.getPage(i),viewport=page.getViewport({scale:1.25});
 const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
 await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;
 await writeFile(resolve(out,'pdf-preview',`page-${i}.png`),canvas.toBuffer('image/png'));
 texts.push((await page.getTextContent()).items.map(item=>item.str).join(' '));
}
const allText=texts.join('\n\n');
assert(/fictional/i.test(allText),'PDF must retain fictional provenance');
await writeFile(resolve(out,'pdf-preview','text.txt'),allText);
await writeFile(resolve(out,'pdf-preview','inspection.json'),JSON.stringify({pages:pdf.numPages,bytes:(await readFile(pdfPath)).length,sha256:hash(await readFile(pdfPath)),containsFictionalLabel:true,containsResidentText:/DEMO Resident/.test(allText),renderedWith:'PDF.js and native canvas'},null,2));
console.log(`PDF rendered: ${pdf.numPages} pages; fictional provenance verified`);
await pdf.destroy();
// A faithful transcoding of the recorded browser, with optional external subtitles.
const movie=resolve(out,'Google-Uttam-Nagar-Verified-Demo.mp4');
execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','warning','-i',verification.video,'-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',movie],{stdio:'inherit'});
const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height','-of','json',movie],{encoding:'utf8'}));
const stamp=v=>{let ms=Math.max(0,Math.floor(v*1000));const h=Math.floor(ms/3600000);ms%=3600000;const m=Math.floor(ms/60000);ms%=60000;const s=Math.floor(ms/1000);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
let captions='';
for(let i=0;i<verification.chapters.length;i++){
 const c=verification.chapters[i],next=verification.chapters[i+1];
 const begin=Math.max(0,c.seconds-.4),end=Math.min(begin+5.5,next?next.seconds-.7:Number(info.format.duration));
 captions+=`${i+1}\n${stamp(begin)} --> ${stamp(Math.max(begin+.8,end))}\n${c.description}\n\n`;
}
await writeFile(resolve(out,'Google-Uttam-Nagar-Verified-Demo.srt'),captions);
await writeFile(resolve(out,'media.json'),JSON.stringify({source:relative(out,verification.video),output:relative(out,movie),editing:'Original browser recording transcoded to H.264 MP4 without cuts, overlays, voiceover or substituted application results; optional external subtitles.',...info},null,2));
console.log(JSON.stringify({movie,...info.format},null,2));
