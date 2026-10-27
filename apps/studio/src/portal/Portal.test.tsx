import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { PublicBuilding, PublicMap } from '@ulpin/api-client/draft';
import { BuildingPage } from './BuildingPage';
import { PortalFrame } from './PortalFrame';
import { RequestPage } from './RequestPage';

vi.mock('./PublicScene', () => ({ PublicScene: ({ label }: { label: string }) => <div aria-label={label} /> }));

// Shape-only rows: every value below is a structural placeholder for the page under test, not a record.
const building: PublicBuilding = {
  id: 'b', name: 'name', areaId: 'a', areaName: 'area', code: 'code', location: null, heightM: null, address: null,
  parcelUlpin: null, datum: null, groundM: null, footprint: { type: 'Polygon', coordinates: [] }, storeys: [],
  records: [], notReleased: 0, updatedAt: '2026-10-26T00:00:00Z',
};
const map: PublicMap = { area: { id: 'a', name: 'area', reference: null }, features: [], released: [], buildings: [] };

function render(path: string, route: string, page: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['public', 'building', building.id], building);
  client.setQueryData(['public', 'map', map.area.id], map);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={page} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('portal record and safety statements', () => {
  it('states in the footer that the portal is not a title document', () => {
    expect(render('/portal', '/portal', <PortalFrame />)).toMatch(
      /<footer[^>]*>Not a title document\. Owner names and documents are not public\.<\/footer>/,
    );
  });

  it('tells the applicant where their name and mobile go', () => {
    expect(render('/portal/request?building=b', '/portal/request', <RequestPage />)).toContain(
      'The details I give are correct. My name and mobile go only to the land records office.',
    );
  });

  it('names the building scene as view only', () => {
    expect(render('/portal/buildings/b', '/portal/buildings/:buildingId', <BuildingPage />))
      .toContain('aria-label="3D view of name, view only"');
  });
});
