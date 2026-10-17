import { PropertyCard, type Fact } from '@ulpin/ui';
import { shortHash } from '../../local/workflow';
import { DRAFT_FACT } from './draft';
import { LOCAL_CHAIN_WORDS, type LocalChain } from './localChain';
import { Qr } from './Qr';

/**
 * The Property Card of a draft made in this browser. A print leaves the page and its notice behind, so the card
 * says what it is by itself: its code is labelled Draft, its first row is the draft sentence and its chain is
 * this browser's own check. `link` is the draft verify page the QR opens.
 */
export function DraftCard({ title, code, location, revision, hash, chain, link, facts }: {
  title: string; code: string | null; location: string[] | null; revision: number; hash: string;
  chain: LocalChain; link: string; facts: Fact[];
}) {
  return (
    <PropertyCard
      title={title} code={code} location={location} state="draft"
      revision={`r${revision}`} hash={shortHash(hash)} chain={LOCAL_CHAIN_WORDS[chain]}
      qr={<Qr value={link} size={88} label="QR code: verification page" />}
      facts={[DRAFT_FACT, ...facts]}
    />
  );
}
