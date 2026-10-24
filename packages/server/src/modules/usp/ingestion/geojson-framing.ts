import type { IntakeCard } from '@ulpin/contracts/usp';

/** Only the probed card chooses framing; neither the name nor unread source bytes select a reader. */
export function intakeGeojsonFraming(card: Pick<IntakeCard, 'format' | 'family'>) {
  if (card.format === 'geojson') return 'feature-collection' as const;
  if (card.family !== 'vector') return null;
  if (card.format === 'ndjson') return 'geojson-lines' as const;
  if (card.format === 'geojson-seq') return 'geojson-seq-rs' as const;
  return null;
}
