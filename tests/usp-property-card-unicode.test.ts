import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UspPropertyCardSchema, PROPERTY_CARD_ASCII_PROFILE, PROPERTY_CARD_UNICODE_PROFILE } from '../packages/contracts/src/usp/property-card';
import { renderPropertyCardProfile, selectPropertyCardProfile } from '../packages/server/src/modules/usp/packets/card-render-profile';
import { cardScriptRuns, CARD_UNICODE_FONT_SHA256 } from '../packages/server/src/modules/usp/packets/card-render-unicode';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { fingerprint } from '../packages/server/src/modules/cases/domain';

const fonts = new URL('../packages/server/src/modules/usp/packets/card-fonts/', import.meta.url);
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
// No property is manufactured. Pins reuse the preserved technical CARD-01 page;
// attributed upstream linguistic strings replace its facts only in this render control.
test('additive Latin/Devanagari profile preserves attributed samples, covered glyphs, logical text, exact QR and old ASCII bytes', async () => {
  const sample = JSON.parse(await readFile(new URL('linguistic-sample.json', fonts), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('manifest.json', fonts), 'utf8'));
  const font = await readFile(new URL('NotoSansDevanagari.ttf', fonts));
  assert.equal(sha256(font), CARD_UNICODE_FONT_SHA256); assert.equal(manifest.font.sha256, CARD_UNICODE_FONT_SHA256);
  const old = JSON.parse(await readFile(new URL('legacy-ascii-render-control.json', fonts), 'utf8')).card;
  const parsed = UspPropertyCardSchema.parse(old);
  const { cardSha256: savedHash, ...savedBody } = parsed;
  assert.equal(fingerprint(savedBody), savedHash);
  assert.equal(parsed.profile, PROPERTY_CARD_ASCII_PROFILE);
  if (process.env.CARD_ASCII_EVIDENCE_DIR) {
    const oldPdf = await readFile(join(process.env.CARD_ASCII_EVIDENCE_DIR, 'property-card.pdf'));
    assert.equal(sha256(oldPdf), parsed.artifact.sha256);
  }
  assert.equal(parsed.artifact.sha256, '54e6186f6a5f754bf304934d255270800fbc6d69a0c23fac123d7bebb9d55eeb');
  assert.equal(selectPropertyCardProfile(parsed.facts), PROPERTY_CARD_ASCII_PROFILE);
  const { artifact, cardSha256, ...content } = parsed;
  const facts = [
    { key: 'purpose', label: 'Rendering control', state: 'available' as const,
      value: 'Attributed linguistic samples only. No operational property facts.', reasonCode: null },
    ...sample.lines.map((line: { line: number; text: string }) => ({ key: `sample_${line.line}`, label: `Noto QA line ${line.line}`,
      state: 'available' as const, value: line.text, reasonCode: null })),
    { key: 'mixed', label: 'Mixed script run control', state: 'available' as const,
      value: sample.lines[0].text + sample.lines[3].text, reasonCode: null },
    { key: 'source', label: 'Attribution', state: 'available' as const,
      value: `Noto Devanagari QA / Android Hindi strings; ${sample.originRevision.slice(0, 12)}. Test text, not a property record.`, reasonCode: null },
  ];
  assert.equal(selectPropertyCardProfile(facts), PROPERTY_CARD_UNICODE_PROFILE);
  assert(cardScriptRuns(facts[6].value).some(run => run.script === 'deva'));
  const card = { ...content, profile: PROPERTY_CARD_UNICODE_PROFILE, facts };
  const bytes = await renderPropertyCardProfile(card);
  assert(bytes.length <= 524288); assert.match(Buffer.from(bytes.subarray(0, 8)).toString(), /^%PDF/);
  if (process.env.CARD_UNICODE_EVIDENCE_DIR) {
    const directory = process.env.CARD_UNICODE_EVIDENCE_DIR; await mkdir(directory, { recursive: true });
    const pdf = join(directory, 'property-card-unicode.pdf'); await writeFile(pdf, bytes);
    await writeFile(join(directory, 'render-content.json'), JSON.stringify(card, null, 2) + '\n');
    assert(process.env.CARD_PDFTOPPM); assert(process.env.CARD_PDF_PYTHON);
    const prefix = join(directory, 'property-card-unicode');
    const render = spawnSync(process.env.CARD_PDFTOPPM, ['-r', '144', '-singlefile', '-png', pdf, prefix], { encoding: 'utf8' });
    assert.equal(render.status, 0, render.error?.message ?? render.stderr);
    const { PNG } = require('pngjs'), jsQR = require('jsqr');
    const png = PNG.sync.read(await readFile(`${prefix}.png`));
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert(qr); assert.equal(qr.data, card.resolverUrl);
    await writeFile(join(directory, 'decoded-qr.txt'), qr.data + '\n');
    const script = `import json,sys,pypdfium2 as pdfium
from pypdf import PdfReader
from pypdf.generic import ContentStream
doc=pdfium.PdfDocument(sys.argv[1]); assert len(doc)==1
page=doc[0].get_textpage(); text=page.get_text_range()
sample=json.load(open(sys.argv[2],encoding='utf-8'))
for line in sample['lines']:
 assert line['text'].strip() in text
 assert page.search(line['text'].strip()).get_next() is not None
reader=PdfReader(sys.argv[1]); stream=ContentStream(reader.pages[0]['/Contents'].get_object(),reader)
actual=[str(args[1]['/ActualText']) for args,op in stream.operations if op==b'BDC' and len(args)>1 and '/ActualText' in args[1]]
for line in sample['lines']: assert line['text'] in actual
print(json.dumps({'pages':1,'extraction':'PDFium exact logical samples/search pass; original ActualText preserved','text':text},ensure_ascii=False))`;
    const extract = spawnSync(process.env.CARD_PDF_PYTHON, ['-c', script, pdf, fileURLToPath(new URL('linguistic-sample.json', fonts))],
      { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    assert.equal(extract.status, 0, extract.error?.message ?? extract.stderr);
    const extraction = JSON.parse(extract.stdout);
    assert(extraction.text.includes('Opens this card revision as a PDF,'));
    await writeFile(join(directory, 'pdf-text.txt'), extraction.text);
    await writeFile(join(directory, 'text-inspection.json'), JSON.stringify(extraction, null, 2));
  }
  await assert.rejects(() => renderPropertyCardProfile({ ...card, facts: [{ ...facts[0], value: '😀' }] }), /Unsupported scripts, glyphs or controls/);
  const overflowingFacts = Array.from({ length: 24 }, (_, i) => ({ ...facts[0], key: `overflow_${i}`,
    label: 'Repeated linguistic sample', value: sample.lines[4].text }));
  await assert.rejects(() => renderPropertyCardProfile({ ...card, facts: overflowingFacts }), /exceed the one-page/);
});
