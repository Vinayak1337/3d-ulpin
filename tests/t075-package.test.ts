import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {zipSync,strToU8} from '../apps/web/node_modules/fflate/esm/index.mjs';
import {readReferencePackage,sha256Bytes} from '../apps/web/features/spatial/reference-import/package';

test('reference ZIP retains every source byte and verifies original fingerprints',async()=>{
  const bytes=new Uint8Array(await readFile('design/reference-map-v5/data/neem-reference-dataset.zip'));
  const pack=await readReferencePackage('neem.zip',bytes);
  assert.deepEqual(pack.originalBytes,bytes);assert.equal(pack.originalSha256,await sha256Bytes(bytes));
  assert.equal(pack.verifiedFiles,14);assert.ok(pack.files.size>=15);assert.equal(JSON.parse(pack.normalizedText).schemaVersion,'1.0.0');
  assert.equal(pack.normalizedText,await readFile('design/reference-map-v5/dataset/normalized.json','utf8'));
});
test('JSON preserves whitespace and original byte identity',async()=>{
  const bytes=strToU8(' { "schemaVersion": "1.0.0" }\n');const pack=await readReferencePackage('source.json',bytes);
  assert.equal(pack.normalizedText,' { "schemaVersion": "1.0.0" }\n');assert.deepEqual(pack.originalBytes,bytes);
});
test('rejects unsafe paths and undeclared archive contents',async()=>{
  await assert.rejects(readReferencePackage('bad.zip',zipSync({'../normalized.json':strToU8('{}')})),/unsafe/);
  const source=strToU8('{}'),manifest=strToU8(JSON.stringify({files:[{path:'normalized.json',bytes:2,sha256:await sha256Bytes(source)}]}));
  await assert.rejects(readReferencePackage('bad.zip',zipSync({'normalized.json':source,'manifest.json':manifest,'extra.txt':strToU8('unlisted')})),/Undeclared/);
});
test('rejects changed normalized bytes and mismatched source fingerprints',async()=>{
  const source=strToU8('{}'),manifest=strToU8(JSON.stringify({files:[{path:'normalized.json',bytes:2,sha256:'0'.repeat(64)}]}));
  await assert.rejects(readReferencePackage('bad.zip',zipSync({'normalized.json':source,'manifest.json':manifest})),/fingerprint/);
  const scene=strToU8(JSON.stringify({sources:[{id:'source',representation:'original_file',originalUri:'dataset/missing.geojson',originalSha256:'0'.repeat(64),byteSize:2}]}));
  const validManifest=strToU8(JSON.stringify({files:[{path:'normalized.json',bytes:scene.length,sha256:await sha256Bytes(scene)}]}));
  await assert.rejects(readReferencePackage('bad.zip',zipSync({'normalized.json':scene,'manifest.json':validManifest})),/Source revision/);
});
test('rejects truncated and oversized packages',async()=>{
  await assert.rejects(readReferencePackage('empty.zip',new Uint8Array()),/nonempty/);
  await assert.rejects(readReferencePackage('large.json',new Uint8Array(20*1024*1024+1)),/20 MB/);
  const zip=zipSync({'a':strToU8('abc')});await assert.rejects(readReferencePackage('broken.zip',zip.slice(0,-5)),/truncated/);
});
test('rejects DEFLATE overflow even when the truncated prefix matches every declared fingerprint',async()=>{
  const prefix=strToU8('{}');
  const manifest=strToU8(JSON.stringify({files:[{path:'normalized.json',bytes:prefix.length,sha256:await sha256Bytes(prefix)}]}));
  const archive=zipSync({'normalized.json':strToU8('{}'+' '.repeat(100000)),'manifest.json':manifest});
  // Forge both ZIP headers to describe the valid JSON prefix, retaining the
  // complete larger DEFLATE stream. A fixed-size inflate buffer accepted this.
  const prefixArchive=zipSync({'normalized.json':prefix});
  const prefixCrc=new DataView(prefixArchive.buffer,prefixArchive.byteOffset,prefixArchive.byteLength).getUint32(14,true);
  const view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength);
  const central=view.getUint32(archive.length-22+16,true);
  assert.equal(view.getUint32(central,true),0x02014b50);
  assert.equal(view.getUint16(central+10,true),8);
  const local=view.getUint32(central+42,true);
  view.setUint32(local+14,prefixCrc,true);view.setUint32(local+22,prefix.length,true);
  view.setUint32(central+16,prefixCrc,true);view.setUint32(central+24,prefix.length,true);
  await assert.rejects(readReferencePackage('forged-length.zip',archive),/expansion exceeds its declared length/);
});
test('wrapped manifests reject same-named undeclared files outside their own directory',async()=>{
  const source=strToU8('{}');
  const manifest=strToU8(JSON.stringify({files:[{path:'normalized.json',bytes:source.length,sha256:await sha256Bytes(source)}]}));
  const declared={'a/normalized.json':source,'a/manifest.json':manifest};
  const valid=await readReferencePackage('wrapped.zip',zipSync(declared));
  assert.equal(valid.verifiedFiles,1);assert.deepEqual(valid.files.get('a/normalized.json'),source);
  await assert.rejects(readReferencePackage('outside-prefix.zip',zipSync({...declared,'b/normalized.json':strToU8('unverified contents')})),/Undeclared package file: b\/normalized\.json/);
});
