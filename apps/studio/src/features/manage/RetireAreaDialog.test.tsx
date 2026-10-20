import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ROUTES, isServed } from '../../local/routes';
import { RETIRE_KEEPS, RetireAreaDialog } from './RetireAreaDialog';

// Shape-only target: the id, name and revision are placeholders for the dialog under test, not a record.
const target = { id: '10000000-0000-4000-8000-000000000020', name: 'area name', revision: 3 };

describe('RetireAreaDialog', () => {
  it('names what stays, asks for a reason and holds the action until one is given', () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <RetireAreaDialog target={target} onClose={() => {}} onRetired={() => {}} />
      </QueryClientProvider>,
    );
    expect(markup).toContain('Retire area name?');
    expect(markup).toContain(RETIRE_KEEPS.replace(/'/g, '&#x27;'));
    expect(RETIRE_KEEPS).toMatch(/Nothing is deleted.*original files, sources, packages, review history and receipts/);
    expect(markup).toContain('leave the area lists, the map and the batch&#x27;s area choices');
    expect(markup).toMatch(/<textarea[^>]*required=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Retire area<\/button>/s);
    expect(markup).not.toContain('Delete');
  });

  it('retires through the live server route; the local delete draft is gone', () => {
    expect(isServed('POST', '/api/v1/areas/:areaId/retire')).toBe(true);
    expect(ROUTES.find((route) => route.method === 'POST' && route.path === '/api/v1/areas/:areaId/retire')?.mode)
      .toBe('live');
    expect(ROUTES.some((route) => route.method === 'DELETE' && route.path === '/api/v1/areas/:areaId')).toBe(false);
  });
});
