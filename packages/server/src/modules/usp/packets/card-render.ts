import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { PropertyCard } from '../../../../../contracts/src/usp/property-card';
import { AppError } from '../../../infrastructure/errors';
import { cardFooterLines, cardHeading, cardLinkLines, printedFact } from './card-wording';

export function propertyCardResolverUrl(cardId: string, revision: number) {
  const port = process.env.API_PORT ?? '3188';
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)
    throw new AppError(503, 'CARD_LOOPBACK_CONFIGURATION', 'API_PORT must be a valid trusted local API port.');
  return `http://127.0.0.1:${Number(port)}/api/v1/usp/property-cards/${cardId}/revisions/${revision}`;
}
type CardContent = Omit<PropertyCard, 'artifact' | 'cardSha256'>;
/** Fresh one-page summary only. No source page objects, scripts, remote media or attachments. */
export function renderPropertyCard(card: CardContent) {
  const texts = card.facts.flatMap(f => [f.label, f.value ?? '', f.reasonCode ?? '']);
  if (texts.some(text => !/^[\x20-\x7e\r\n]*$/.test(text)))
    throw new AppError(422, 'CARD_TEXT_PROFILE', 'This card profile supports printable ASCII text only. Multilingual font/shaping support is unavailable; source text was not replaced.');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
  doc.setProperties({ title: 'Private property card', subject: 'Exact recorded snapshot; application summary', creator: '3D ULPIN CARD-01' });
  doc.setCreationDate(new Date(card.createdAt));
  doc.setFillColor(237, 243, 240); doc.rect(0, 0, 596, 100, 'F');
  doc.setTextColor(20, 47, 38); doc.setFont('helvetica', 'bold'); doc.setFontSize(23);
  const heading = cardHeading(card);
  doc.text(heading.title, 36, 43);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(heading.revision, 36, 64);
  doc.setFontSize(9); doc.text(heading.disclaimer, 36, 82);
  let y = 122;
  for (const fact of card.facts) {
    const value = printedFact(fact);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(value, 365) as string[];
    if (y + lines.length * 12 > 605)
      throw new AppError(422, 'CARD_LAYOUT_PROFILE', 'These exact facts exceed the one-page profile. The packet remains available; no facts were truncated.');
    doc.setFont('helvetica', 'bold'); doc.text(fact.label, 36, y);
    doc.setFont('helvetica', 'normal'); doc.text(lines, 190, y, { lineHeightFactor: 1.3 });
    y += Math.max(14, lines.length * 12) + 8;
  }
  doc.setDrawColor(170, 185, 178); doc.line(36, 622, 559, 622);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  for (const [i, line] of cardFooterLines(card).entries()) doc.text(line, 36, 644 + i * 13);
  const qr = QRCode.create(card.resolverUrl, { errorCorrectionLevel: 'M' });
  const quiet = 4, size = qr.modules.size, step = 132 / (size + quiet * 2), x = 420, top = 635;
  doc.setFillColor(255, 255, 255); doc.rect(x, top, 132, 132, 'F'); doc.setFillColor(0, 0, 0);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.modules.get(r, c))
    doc.rect(x + (c + quiet) * step, top + (r + quiet) * step, step, step, 'F');
  doc.link(x, top, 132, 132, { url: card.resolverUrl });
  const link = cardLinkLines(card.resolverUrl);
  doc.setFontSize(8);
  for (const [i, line] of link.caption.entries()) doc.text(line, x, 780 + i * 12);
  doc.setFontSize(6);
  for (const [i, line] of link.address.entries()) doc.text(line, x, 803 + i * 8);
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  if (bytes.length > 524288) throw new AppError(413, 'CARD_OUTPUT_BOUND', 'The bounded one-page PDF exceeds 512 KiB.');
  return bytes;
}
