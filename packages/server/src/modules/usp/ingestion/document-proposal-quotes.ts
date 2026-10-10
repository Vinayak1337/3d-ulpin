import type { z } from 'zod';
import type {
  DocumentProposalInputSchema, DocumentProposalQuoteCheckSchema, DocumentProposalLocatorSchema,
} from '../../../../../contracts/src/usp/document-proposals';

type Proposal = z.output<typeof DocumentProposalInputSchema>;
type Check = z.output<typeof DocumentProposalQuoteCheckSchema>;
type Locator = z.output<typeof DocumentProposalLocatorSchema>;
export type QuotePage = {
  page: number;
  frame: Locator['frame'] | null;
  lines: { text: string; box: Locator['box'] }[];
  basis: NonNullable<Check['basis']>;
  storedRegion?: Locator['box'];
};

// Python re \s includes NEL and C0 separators, but not the JavaScript-only BOM whitespace.
const normalise = (text: string) => text.normalize('NFKC').replace(/[\t-\r\u001c-\u0020\u0085\p{Z}]+/gu, ' ')
  .replace(/^ +| +$/g, '');
const digits = (text: string) => text.normalize('NFKC').match(/\p{Decimal_Number}+/gu) ?? [];

/** Same positive-area intersection and line ordering as storey_quote_verifier.region_text. */
export function quoteRegionText(page: QuotePage | undefined, locator: Locator): string | null {
  if (!page) return null;
  const box = locator.box ?? locator.selectedRegion;
  const region = page.storedRegion;
  if (region) {
    if (!box || box[0] < region[0] || box[1] < region[1] || box[2] > region[2] || box[3] > region[3]) {
      return null;
    }
  }
  if (box && (page.frame === null || page.lines.some((line) => line.box === null))) return null;
  const lines = page.lines.filter((line) => {
    if (!box) return true;
    const other = line.box!;
    return other[0] < box[2] && box[0] < other[2] && other[1] < box[3] && box[1] < other[3];
  });
  return normalise(lines.map((line) => line.text).join(' '));
}

/** Presence in stored region text only: never OCR accuracy, fact truth, officer review or learning authority. */
export function checkDocumentProposalQuote(regionText: string | null, proposal: Proposal): Omit<Check, 'basis'> {
  if (!proposal.quote) return { outcome: 'not_checked', reason: 'no_quote' };
  if (regionText === null) return { outcome: 'not_checked', reason: 'no_region_text' };
  if (!normalise(regionText).includes(normalise(proposal.quote))) {
    return { outcome: 'quote_not_at_locator', reason: 'quote_not_at_locator' };
  }
  const available = new Set(digits(proposal.quote));
  if (proposal.valueLiteral !== undefined && digits(proposal.valueLiteral).some((group) => !available.has(group))) {
    return { outcome: 'quote_not_at_locator', reason: 'value_not_in_quote' };
  }
  return { outcome: 'quote_at_locator', reason: null };
}
