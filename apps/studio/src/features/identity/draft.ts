/**
 * The one sentence for a code, card or revision made in this browser's own store. Every place that shows such a
 * thing imports it, so a draft is worded the same way everywhere and never reads as a registry record.
 */
export const DRAFT_ON_THIS_DEVICE = 'Draft on this device, not a registry record';

/** The row a printed draft card carries: the print leaves the page and its notice behind. */
export const DRAFT_FACT = { label: 'Record', value: DRAFT_ON_THIS_DEVICE };

/** The label of the day a draft code was made in this browser. No registry assigned it, so not "Assigned". */
export const DRAFT_MADE = 'Draft made';

export interface DraftLead {
  text: string;
  tone: 'neutral' | 'warning';
}

/**
 * The line a draft's verify page leads with. It names the draft and claims no validity: no registry holds it.
 * `asked` is the revision the address named, `head` the newest revision this device holds.
 */
export function draftLead(asked: number | null, head: number): DraftLead {
  if (asked !== null && asked < head) return { text: `Superseded by revision r${head}`, tone: 'warning' };
  return { text: `Draft revision r${head} on this device`, tone: 'neutral' };
}
