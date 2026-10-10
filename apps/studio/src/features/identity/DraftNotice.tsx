import { Banner } from '@ulpin/ui';
import { DRAFT_ON_THIS_DEVICE } from './draft';

const SHOWN_BELOW = 'the code, revisions and chain below were created in this browser and are not checked by the '
  + 'server.';

/**
 * Stated wherever a code, card or chain made in this browser is shown or is about to be made: none of it is a
 * registry record. `children` says which things are meant; the default is a code shown with its revisions.
 */
export function DraftNotice({ children = SHOWN_BELOW }: { children?: string }) {
  return <Banner tone="warning">{DRAFT_ON_THIS_DEVICE}: {children}</Banner>;
}
