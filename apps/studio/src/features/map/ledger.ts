import type { BuildingLedger, RightsCategory } from '@ulpin/api-client/draft';
import type { StatusWord } from '@ulpin/ui';

export type LedgerSpace = BuildingLedger['spaces'][number];

export const RIGHTS_LABEL: Record<RightsCategory, string> = {
  exclusive: 'Exclusive unit', shared: 'Shared area', public: 'Public or authority', unknown: 'Unknown',
};
export const RIGHTS_TOKEN: Record<RightsCategory, string> = {
  exclusive: '--ui-rights-exclusive', shared: '--ui-rights-shared', public: '--ui-rights-public', unknown: '--ui-readiness-unknown',
};

/** The scene needs real colour strings, so rights colours are read from the design tokens once. */
export function tokenColour(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

export function ledgerStatus(status: BuildingLedger['status'] | undefined): StatusWord | null {
  return status === 'reviewed' ? 'Reviewed' : status === 'needs_review' ? 'Needs review' : status === 'draft' ? 'Draft' : null;
}

export function ledgerSpace(ledger: BuildingLedger | null | undefined, spaceId: string): LedgerSpace | undefined {
  return ledger?.spaces.find((s) => s.spaceId === spaceId);
}
