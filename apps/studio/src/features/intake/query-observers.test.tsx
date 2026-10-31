import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { container } from './fake-dom';
import { intakeKey, rereadQuery, useIntakeManifest } from './batch-queries';
import { useReading } from './reading-model';
import { DeclareLink, EvidenceByKey } from './evidence/EvidenceByKey';
import { evidenceKey, useEvidencePage } from './evidence/api';
import type { IntakeItem } from './batch-model';

// Protocol controls based on the captured manifest; no source means no reading or profile fetch is permitted.
const row = { ...captured.manifest.items[0], sourceId: null } as unknown as IntakeItem;
const manifest = { caseId: row.caseId, items: [row] };
const evidence = { profiles: [], sources: [], candidates: [], confirmations: [],
  counts: { matched: 0, no_match: 0, several: 0, conflicting: 0 }, nextCursor: null };
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));
afterEach(() => vi.unstubAllGlobals());

function mountObservers(active: () => void, passive: () => React.ReactNode) {
  function Active() {
    active();
    return null;
  }
  function Passive() { return passive(); }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container() as never);
  const observer = <Active />;
  const render = async () => {
    await act(async () => root.render(<QueryClientProvider client={client}>
      {observer}<Passive />
    </QueryClientProvider>));
    await settle();
  };
  const close = () => act(async () => {
    root.unmount();
    client.clear();
  });
  return { client, render, close };
}

it.each(['reading', 'declaration'])('the %s cache observer cannot erase the manifest fetcher', async observer => {
  const reads = vi.fn();
  const fetch = vi.fn(async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/intake')) {
      reads();
      return Response.json(manifest);
    }
    return Response.json({ items: [], packages: [] });
  });
  vi.stubGlobal('fetch', fetch);
  const page = mountObservers(() => { useIntakeManifest(row.caseId); }, () => {
    if (observer === 'declaration') return <DeclareLink caseId={row.caseId} onDeclare={vi.fn()}
      link={{ fromItemId: row.itemId, itemId: row.itemId, by: 'place', fields: null, basis: 'reader', words: '' }} />;
    return <ReadingObserver />;
  });
  function ReadingObserver() {
    useReading(row.caseId, row.itemId);
    return null;
  }
  try {
    await page.render();
    await page.render();
    expect(reads).toHaveBeenCalledTimes(1);
    rereadQuery(page.client, intakeKey(row.caseId));
    await settle();
    expect(page.client.getQueryState(intakeKey(row.caseId))?.error).toBeNull();
    expect(reads).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([request]) => !request.url.endsWith('/reading'))).toBe(true);
  } finally {
    await page.close();
  }
});

it('a no-anchor evidence observer cannot erase the open evidence page fetcher', async () => {
  const reads = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/evidence')) {
      reads();
      return Response.json(evidence);
    }
    return Response.json({ items: [], packages: [] });
  }));
  const page = mountObservers(() => { useEvidencePage(row.caseId, '', null); },
    () => <EvidenceByKey caseId={row.caseId} items={[]} />);
  try {
    await page.render();
    await page.render();
    expect(reads).toHaveBeenCalledTimes(1);
    rereadQuery(page.client, evidenceKey(row.caseId));
    await settle();
    expect(page.client.getQueryState([...evidenceKey(row.caseId), '', null])?.error).toBeNull();
    expect(reads).toHaveBeenCalledTimes(2);
  } finally {
    await page.close();
  }
});
