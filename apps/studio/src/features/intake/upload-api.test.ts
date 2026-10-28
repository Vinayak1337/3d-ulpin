import { afterEach, expect, it, vi } from 'vitest';
import { uploadTransport } from './upload-api';
import type { UploadCreate } from './upload-model';

afterEach(() => vi.restoreAllMocks());

it('passes the optional create signal to fetch so a silent request can be aborted before replay', async () => {
  const controller = new AbortController();
  let active = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const request = input as Request;
    active++;
    return new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => {
        active--;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });
  const body: UploadCreate = { requestKey: crypto.randomUUID(), expectedCaseRevision: 1,
    filename: 'control.geojson', mediaType: 'application/octet-stream', bytes: 1, sha256: 'a'.repeat(64),
    profile: 'large-original/1', provenance: { origin: 'not_stated', acquiredAt: '2026-10-11T00:00:00Z' } };
  const transport = uploadTransport(crypto.randomUUID());
  const sent = transport.create(body, controller.signal);
  const refused = expect(sent).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(active).toBe(1));
  const request = fetch.mock.calls[0]![0] as Request;
  expect(await request.clone().json()).toEqual(body);
  controller.abort();
  await refused;
  expect(active).toBe(0);
  expect(request.signal.aborted).toBe(true);
});
