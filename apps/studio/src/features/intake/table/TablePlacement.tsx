import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, ApiError, unwrap } from '@ulpin/api-client';
import { Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from '../batch-model';
import { useIntakeManifest } from '../batch-queries';
import { PlaceOnMap } from '../PlaceOnMapDialog';
import { TableRefusal } from './Progress';
import type { TableProfile } from './types';

type ItemIds = Pick<IntakeItem, 'itemId' | 'sourceId' | 'parentItemId'>;
interface Enrol { press: () => void; pending: boolean; error: Error | null }

/** TB2: the batch item of the table's own kept original; a workbook sheet or a ZIP member is another item. */
export function tableItemId(items: readonly ItemIds[], sourceId: string): string | null {
  return items.find(item => item.sourceId === sourceId && !item.parentItemId)?.itemId ?? null;
}

/**
 * TB2: one press enrols the kept original as an item of its case's batch, through the existing intake enrolment;
 * nothing is uploaded again. A lost answer is sent again with the same key; a refusal makes the next press a new one.
 */
export function createTableEnrolment(caseId: string, sourceId: string,
  key: () => string = () => crypto.randomUUID()) {
  let requestKey: string | null = null;
  return async (): Promise<string> => {
    requestKey ??= key();
    try {
      return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items', {
        params: { path: { caseId } }, body: { sourceId, requestKey },
      })).itemId;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) requestKey = null;
      throw error;
    }
  };
}

/** TB2: a table dropped alone is placed on the map as a batch item is, from the same kept original. */
export function TablePlacement({ caseId, sourceId, name, profile }: {
  caseId: string; sourceId: string; name: string; profile: TableProfile;
}) {
  const client = useQueryClient();
  const manifest = useIntakeManifest(caseId);
  const [send] = useState(() => createTableEnrolment(caseId, sourceId));
  const enrol = useMutation({ mutationFn: send,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['intake', caseId] }) });
  if (manifest.isPending) return <Skeleton />;
  const itemId = tableItemId(manifest.data?.items ?? [], sourceId) ?? enrol.data ?? null;
  return <PlacementBody caseId={caseId} itemId={itemId} name={name} headers={profile.headers}
    opened={enrol.isSuccess}
    enrol={{ press: () => enrol.mutate(), pending: enrol.isPending, error: enrol.error }} />;
}

export function PlacementBody({ caseId, itemId, name, headers, opened, enrol }: {
  caseId: string; itemId: string | null; name: string; headers: readonly string[];
  opened: boolean; enrol: Enrol;
}) {
  let body: React.ReactNode;
  if (itemId) body = <>
    <PlaceOnMap caseId={caseId} itemId={itemId} name={name} headers={headers} opened={opened} />
    <p className="ul-help">
      This file is an item of its case&apos;s batch. <Link to={`/studio/work/cases/${caseId}/intake`}>Its line in
      the batch</Link> says how many rows were prepared and how many were skipped, and why. That GeoJSON file is
      then taken in as its own item in this batch, and its own line says whether it is on the map.
    </p>
  </>;
  else body = <>
    <p className="ul-help">
      If its rows hold coordinates, this table can be placed on the map as in a batch. It first joins its case&apos;s
      batch as an item, from the same kept original; no second copy is kept. You then choose the coordinate columns
      and the coordinate system; none is chosen for you.
    </p>
    <div><Button variant="soft" disabled={enrol.pending} onClick={enrol.press}>Place on the map</Button></div>
    {enrol.error ? <TableRefusal error={enrol.error} /> : null}
  </>;
  return <section className="ul-stack" aria-label={`Place ${name} on the map`}>
    <h2 className="ul-heading">Place on the map</h2>
    {body}
  </section>;
}
