import { Banner } from '@ulpin/ui';

/** Stated wherever a code, card or chain made in this browser is shown: none of it is a registry record. */
export function DraftNotice() {
  return (
    <Banner tone="warning">
      Draft on this device. Not a registry record: the code, revisions and chain below were created in this browser
      and are not checked by the server.
    </Banner>
  );
}
