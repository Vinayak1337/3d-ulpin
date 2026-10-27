import { Banner } from '@ulpin/ui';
import { DRAFT_ON_THIS_DEVICE } from './draft';

/**
 * Stated wherever a code, card or chain made in this browser is shown or is about to be made: none of it is a
 * registry record. `children`, when given, says which things are meant.
 */
export function DraftNotice({ children }: { children?: string }) {
  return <Banner tone="warning">{children ? `${DRAFT_ON_THIS_DEVICE}: ${children}` : DRAFT_ON_THIS_DEVICE}</Banner>;
}
