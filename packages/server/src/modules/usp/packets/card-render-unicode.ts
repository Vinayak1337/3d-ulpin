import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type PDFKit from 'pdfkit';
import type { Font } from 'fontkit';
import type { PropertyCard } from '../../../../../contracts/src/usp/property-card';
import { PROPERTY_CARD_UNICODE_PROFILE } from '../../../../../contracts/src/usp/property-card';
import QRCode from 'qrcode';
import { settings } from '../../../infrastructure/config';
import { sha256 } from '../../../infrastructure/storage';
import { AppError } from '../../../infrastructure/errors';

// Repo-owned, pinned assets also resolve from the existing bundled API/server.
// Runtime require keeps PDFKit's own package resources intact when our code is bundled.
const require = createRequire(join(settings.repositoryRoot, 'packages/server/package.json'));
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
const fontkit = require('fontkit') as typeof import('fontkit');
export const CARD_UNICODE_FONT_SHA256 = '14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e';
const fontPath = join(settings.repositoryRoot, 'packages/server/src/modules/usp/packets/card-fonts/NotoSansDevanagari.ttf');
const MAX_BYTES = 524288;
type Content = Omit<PropertyCard, 'artifact' | 'cardSha256'>;
const profileError = () => new AppError(422, 'CARD_TEXT_PROFILE', 'This card profile supports covered Latin and Devanagari text only. Unsupported scripts, glyphs or controls were not replaced.');
const layoutError = () => new AppError(422, 'CARD_LAYOUT_PROFILE', 'These exact facts exceed the one-page profile. No facts were truncated.');
const segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' });
/** Script runs only; shaping, glyph substitution, positioning and line wrapping
 * belong to Fontkit/PDFKit. Grapheme boundaries keep matras/combining marks intact. */
export function cardScriptRuns(text: string) {
  const runs: { script: string; text: string }[] = [];
  for (const { segment } of segmenter.segment(text)) {
    const script = /\p{Script=Devanagari}/u.test(segment) ? 'deva' : /\p{Script=Latin}/u.test(segment) ? 'latn' : runs.at(-1)?.script ?? 'common';
    if (runs.at(-1)?.script === script) runs.at(-1)!.text += segment;
    else runs.push({ script, text: segment });
  }
  return runs;
}
function checkText(text: string, font: Font) {
  for (const char of text) {
    if (char === '\n' || char === '\r') continue;
    if (char === '\u200c' || char === '\u200d') continue; // Devanagari shaping controls, never arbitrary bidi/control codes.
    if (/\p{C}/u.test(char) || !/^[\p{Script=Latin}\p{Script=Devanagari}\p{Script=Common}\p{Script=Inherited}]$/u.test(char)
      || !font.hasGlyphForCodePoint(char.codePointAt(0)!)) throw profileError();
  }
  for (const run of cardScriptRuns(text)) if (run.text.replace(/[\r\n]/g, '').length
    && font.layout(run.text.replace(/[\r\n]/g, '')).glyphs.some(g => g.id === 0)) throw profileError();
}
/** PDF marked ActualText retains exact logical input for extraction/search while
 * the embedded glyphs have the visual order/offsets produced by Indic shaping. */
function drawText(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, size: number) {
  doc.fontSize(size); doc.markContent('Span', { actual: text });
  const runs = cardScriptRuns(text);
  for (const [i, run] of runs.entries()) {
    const options = { width, lineGap: 1.5, continued: i < runs.length - 1 };
    if (i === 0) doc.text(run.text, x, y, options);
    else doc.text(run.text, options);
  }
  doc.endMarkedContent();
  return doc.y - y;
}
/** Fresh bounded summary; no original pages, remote assets, scripts or fallback fonts. */
export async function renderUnicodePropertyCard(card: Content) {
  if (card.profile !== PROPERTY_CARD_UNICODE_PROFILE) throw profileError();
  const bytes = readFileSync(fontPath);
  if (bytes.length !== 641944 || sha256(bytes) !== CARD_UNICODE_FONT_SHA256)
    throw new AppError(503, 'CARD_FONT_INTEGRITY', 'The pinned card font is unavailable or changed.');
  const parsed = fontkit.create(bytes);
  if (!('layout' in parsed)) throw new AppError(503, 'CARD_FONT_INTEGRITY', 'The pinned single-font profile is unavailable.');
  const texts = card.facts.flatMap(f => [f.label, f.value ?? '', f.reasonCode ?? '']);
  if (Buffer.byteLength(texts.join(''), 'utf8') > 32768) throw layoutError();
  for (const text of texts) checkText(text, parsed);
  // No standard/system font is opened. Only this verified font enters the output.
  // PDFKit accepts font buffers here; its older public declarations type this constructor option as string only.
  const doc = new PDFDocument({ size: 'A4', margin: 0, font: bytes as unknown as string, compress: true, bufferPages: true,
    info: { Title: 'Private property card', Subject: 'Exact recorded snapshot; application summary', Creator: '3D ULPIN CARD-I18N-01',
      CreationDate: new Date(card.createdAt), ModDate: new Date(card.createdAt) } });
  const chunks: Buffer[] = []; let count = 0;
  const result = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      count += chunk.length;
      if (count > MAX_BYTES) doc.destroy(new AppError(413, 'CARD_OUTPUT_BOUND', 'The bounded one-page PDF exceeds 512 KiB.'));
      else chunks.push(chunk);
    });
    doc.once('error', reject); doc.once('end', () => resolve(Buffer.concat(chunks, count)));
  });
  // Consume a rendering failure even when synchronous layout rejects first.
  result.catch(() => {});
  try {
    doc.rect(0, 0, 596, 100).fill('#edf3f0'); doc.fillColor('#142f26');
    drawText(doc, 'Property card', 36, 18, 523, 23);
    drawText(doc, `PRIVATE - Exact card revision ${card.revision} - ${card.scope.stage} snapshot`, 36, 56, 523, 10);
    drawText(doc, 'Application summary. No official ULPIN issuance, title or legal approval is implied.', 36, 76, 523, 8.5);
    let y = 116;
    for (const fact of card.facts) {
      const value = fact.state === 'available' ? fact.value! : `${fact.state}: ${fact.value ?? fact.reasonCode}`;
      const labelHeight = drawText(doc, fact.label, 36, y, 144, 9.2);
      const valueHeight = drawText(doc, value, 190, y, 365, 9.2);
      if (doc.bufferedPageRange().count !== 1 || y + Math.max(labelHeight, valueHeight) > 605) throw layoutError();
      y += Math.max(labelHeight, valueHeight) + 8;
    }
    doc.moveTo(36, 622).lineTo(559, 622).lineWidth(0.5).stroke('#aab9b2');
    const footer = [
      `Card: ${card.cardId} / ${card.revision}`, `Plan: ${card.planId} / ${card.planVersion}`, `Packet: ${card.packetId}`,
      `Included entries: ${card.evidenceEntrySha256.length}; optional omissions: ${card.omissions.length}`,
      `Snapshot captured: ${card.snapshotCapturedAt}`, `Card expires: ${card.expiresAt}`,
      'Packet SHA-256 (byte consistency):', card.packetSha256,
      'Snapshot facts are fixed; current record revisions may differ.', 'The detail packet remains separately authorized.',
    ];
    for (const [i, text] of footer.entries()) drawText(doc, text, 36, 636 + i * 13.5, 375, 7.5);
    const qr = QRCode.create(card.resolverUrl, { errorCorrectionLevel: 'M' }), quiet = 4;
    const step = 132 / (qr.modules.size + 2 * quiet), x = 420, top = 635;
    doc.rect(x, top, 132, 132).fill('#ffffff');
    for (let r = 0; r < qr.modules.size; r++) for (let c = 0; c < qr.modules.size; c++) if (qr.modules.get(r, c))
      doc.rect(x + (c + quiet) * step, top + (r + quiet) * step, step, step).fill('#000000');
    doc.link(x, top, 132, 132, card.resolverUrl); doc.fillColor('#142f26');
    drawText(doc, 'Local demonstration link', x, 775, 140, 7.5);
    drawText(doc, 'Private operator access', x, 790, 140, 7.5);
    if (doc.bufferedPageRange().count !== 1) throw layoutError();
    doc.end(); return await result;
  } catch (error) { doc.destroy(); throw error; }
}
