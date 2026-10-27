import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {assemblePacketPdf} from '../packages/server/src/modules/usp/packets/pdf-render';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Opt-in retained actual crop; this is assembly proof, never target authority.
const root=process.env.ULPIN_PACKET_PDF_TEST_ROOT;
const prior='E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
test('one retained clean crop becomes deterministic image-only PDF; wrong crop refuses',
  {skip:!root},async()=>{
    assert(path.isAbsolute(root!));
    const region=JSON.parse(await readFile(path.join(prior,'result.json'),'utf8'));
    const png=await readFile(path.join(prior,'region.png'));
    const output=assemblePacketPdf(region,png),again=assemblePacketPdf(region,png);
    assert.deepEqual(output.bytes,again.bytes);assert.equal(output.manifest.region.sourceSha256,region.sourceSha256);
    const objects=output.bytes.toString('latin1');
    assert(objects.includes('/Subtype /Image'));assert(!/\/Annots|\/EmbeddedFiles|\/JavaScript|\/AcroForm|\/Type \/Font\b/.test(objects));
    assert(!objects.includes('/URI'));assert.equal(output.manifest.output.pages,1);
    const changed=Buffer.from(png);changed[changed.length-1]^=1;
    assert.throws(()=>assemblePacketPdf(region,changed),(error:any)=>error instanceof AppError&&error.code==='PACKET_PDF_CROP_INTEGRITY');
    const shifted=structuredClone(region);shifted.transform.pixelRegion[0]++;
    assert.throws(()=>assemblePacketPdf(shifted,png),(error:any)=>error instanceof AppError&&error.code==='PACKET_PDF_CROP_INTEGRITY');
    await mkdir(root!,{recursive:true});
    await writeFile(path.join(root!,'assembled-region.pdf'),output.bytes,{flag:'wx'});
    await writeFile(path.join(root!,'assembly.json'),JSON.stringify(output.manifest,null,2),{flag:'wx'});
  });
