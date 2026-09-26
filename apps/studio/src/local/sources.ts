import areas from './data/nyc-bronx-areas.json';
import context from './data/nyc-bronx-context.json';
import lineage from './data/nyc-bronx-lineage.json';

/**
 * Local records derived from retained official sources by scripts/derive-official-area.mjs.
 * Each set carries its lineage (source file, SHA-256, provider, terms, limits).
 */
export const LOCAL_SOURCE_LABEL = 'NYC OTI building footprints (derived)';

export const derivedAreas = areas;
export const derivedContexts: Record<string, unknown> = { [context.area.id]: context };
export const derivedLineage = lineage;
