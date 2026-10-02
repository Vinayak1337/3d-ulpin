import { PROPERTY_CARD_ASCII_PROFILE, PROPERTY_CARD_UNICODE_PROFILE, type PropertyCard, type PropertyCardFact } from '../../../../../contracts/src/usp/property-card';
import { renderPropertyCard } from './card-render';
import { renderUnicodePropertyCard } from './card-render-unicode';

/** Server-owned additive selection. Stored cards retain their original profile;
 * neither a replay nor a resolver ever regenerates an older artifact. */
export function selectPropertyCardProfile(facts: readonly PropertyCardFact[]) {
  return facts.every(f => [f.label, f.value ?? '', f.reasonCode ?? ''].every(s => /^[\x20-\x7e\r\n]*$/.test(s)))
    ? PROPERTY_CARD_ASCII_PROFILE : PROPERTY_CARD_UNICODE_PROFILE;
}
export async function renderPropertyCardProfile(card: Omit<PropertyCard, 'artifact' | 'cardSha256'>) {
  return card.profile === PROPERTY_CARD_ASCII_PROFILE ? renderPropertyCard(card) : renderUnicodePropertyCard(card);
}
