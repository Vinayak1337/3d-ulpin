import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EvidenceViewer } from './EvidenceViewer';
import { citedPageOf } from './citedPage';
import type { EvidenceRef } from './refs';
import type { PagesResponse } from './pageGeometry';
import step0 from '../../../../../docs/evidence/gf5/ev1/step0.json';

const listing = step0.viewer.listing as PagesResponse;
const source = { id: listing.sourceId, revision: listing.sourceRevision, sha256: listing.sourceSha256 };
const evidence: EvidenceRef = {
  sourceId: source.id,
  sourceSha256: source.sha256,
  label: 'Fixture citation',
  locator: { kind: 'page', page: 1, text: 'p.1' },
};
const pin = { revision: source.revision, sha256: source.sha256 };

function viewer(sources: (typeof source)[], reduced = false, region = false): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sources.forEach((item, index) => client.setQueryData(['buildings', `fixture-${index}`, 'register'], {
    sources: [item],
  }));
  if (sources.length) {
    const page = citedPageOf(listing, 1, pin);
    const drawn = { ...page, renderSupport: 'supported', url: '/fixture.png' };
    if (reduced) Object.assign(drawn, { renderSupport: 'reduced', reducedScalePxPerPt: 0.5413766434648105 });
    client.setQueryData(['cited-page', source.id, pin.revision, pin.sha256, 1], drawn);
    client.setQueryData(['page-image', '/fixture.png'], '/fixture.png');
  }
  const target: EvidenceRef = region ? { ...evidence, locator: {
    kind: 'region', page: 1, text: 'Fixture region',
    region: { x: 850, y: 875, width: 170, height: 35, unit: 'pt' },
  } } : evidence;
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EvidenceViewer evidence={target} still={null} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  client.clear();
  return markup;
}

describe('candidate evidence navigation and reduced sheet controls', () => {
  it('opens at the cited page when a loaded read states its pin', () => {
    const markup = viewer([source]);
    expect(markup).toContain('Fixture citation · p.1');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('revision is not stated');
  });

  it('uses the file view and states why the page is not shown when no read pins the source', () => {
    const markup = viewer([]);
    expect(markup).toContain('revision is not stated by agreeing reads');
    expect(markup).not.toContain('<svg');
  });

  it('uses the file view with the same honest statement when two loaded reads disagree', () => {
    const markup = viewer([source, { ...source, revision: source.revision + 1 }]);
    expect(markup).toContain('revision is not stated by agreeing reads');
    expect(markup).not.toContain('<svg');
  });

  it('draws a reduced whole sheet with an outline and offers the region only on a press', () => {
    const markup = viewer([source], true, true);
    expect(markup).toContain('reduced scale of 0.54 px per pt');
    expect(markup).toContain('Small text is not readable at this scale.');
    expect(markup).toContain('Show the cited region');
    expect(markup).toContain('<rect');
    expect(markup).not.toContain('drawn by the server from the original');
  });

  it('draws a reduced page-only citation without offering a region action', () => {
    const markup = viewer([source], true);
    expect(markup).toContain('reduced scale of 0.54 px per pt');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('Show the cited region');
    expect(markup).not.toContain('<rect');
  });
});
