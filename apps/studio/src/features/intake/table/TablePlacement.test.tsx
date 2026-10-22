import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { TABLE_PLACEMENT_UTF16 } from '@ulpin/contracts/usp';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../../local/contract';
import { placementRefusal } from '../table-placement-command';
import { createTableEnrolment, PlacementBody, tableItemId } from './TablePlacement';
import type { TableProfile } from './types';

const root = resolve(import.meta.dirname, '../../../../../..');
const validate = createContractValidator(JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')));
// The table profile the server answered for the real mi-d10-02.csv (docs/evidence/gf1/ui/f3a).
const responses = JSON.parse(readFileSync(resolve(root, 'docs/evidence/gf1/ui/f3a/table-responses.json'), 'utf8'));
const profile: TableProfile = responses.files[0].profile;
const caseId = profile.caseId;
const sourceId = profile.source.sourceId;
// LQ1a's captured manifest row, as the answer of an enrolment; only its ids are read here.
const enrolled = { ...captured.manifest.items[0], streamedProfileJobId: null };
const id = (n: number) => `30000000-0000-4000-8000-00000000000${n}`;
const idle = { press: () => {}, pending: false, error: null };

afterEach(() => vi.unstubAllGlobals());

it('TB2: the table\'s batch item is the one of its own kept original, never a sheet or another file', () => {
  const items = [{ itemId: id(1), sourceId: id(9), parentItemId: null },
    { itemId: id(2), sourceId, parentItemId: id(3) }, { itemId: id(4), sourceId, parentItemId: null }];
  expect(tableItemId(items, sourceId)).toBe(id(4));
  expect(tableItemId(items.slice(0, 2), sourceId)).toBeNull();
});

it('TB2: the press enrols the kept original through the intake route; a lost answer resends the same key',
  async () => {
    const bodies: unknown[] = [];
    let lose = true;
    vi.stubGlobal('fetch', async (request: Request) => {
      expect(`${request.method} ${new URL(request.url).pathname}`)
        .toBe(`POST /api/v1/ingestion/cases/${caseId}/intake/items`);
      bodies.push(await request.json());
      if (lose) {
        lose = false;
        throw new TypeError('Failed to fetch');
      }
      return Response.json(enrolled, { status: 201 });
    });
    let n = 0;
    const enrol = createTableEnrolment(caseId, sourceId, () => id(++n));
    await expect(enrol()).rejects.toThrow('Failed to fetch');
    expect(await enrol()).toBe(enrolled.itemId);
    expect(bodies).toEqual([{ sourceId, requestKey: id(1) }, { sourceId, requestKey: id(1) }]);
    expect(validate('POST_ingestion_cases_caseId_intake_items_Request_application_json', bodies[0])).toEqual([]);
    expect(validate('POST_ingestion_cases_caseId_intake_items_Response_201_application_json', enrolled)).toEqual([]);
  });

it('TB2: a refused enrolment makes the next press a new request', async () => {
  const keys: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    keys.push((await request.json()).requestKey);
    return Response.json({ error: { code: 'INGESTION_CASE_ARCHIVED', message: 'The source case is archived.' } },
      { status: 403 });
  });
  let n = 0;
  const enrol = createTableEnrolment(caseId, sourceId, () => id(++n));
  await expect(enrol()).rejects.toBeInstanceOf(ApiError);
  await expect(enrol()).rejects.toBeInstanceOf(ApiError);
  expect(keys).toEqual([id(1), id(2)]);
});

const render = (fields: Partial<Parameters<typeof PlacementBody>[0]>) => renderToStaticMarkup(<MemoryRouter>
  <PlacementBody caseId={caseId} itemId={null} name="mi-d10-02.csv" headers={profile.headers} refusal={null}
    opened={false} enrol={idle} {...fields} />
</MemoryRouter>);

it('TB2: a table not yet in a batch offers Place on the map and says the same kept original joins the batch', () => {
  const html = render({});
  expect(html).toContain('>Place on the map</button>');
  expect(html).toContain('It first joins its case&#x27;s batch as an item, from the same kept original; no second '
    + 'copy is kept.');
  expect(html).toContain('You then choose the coordinate columns and the coordinate system; none is chosen for you.');
  expect(render({ enrol: { ...idle, pending: true } })).toContain('disabled=""');
});

it('TB2: once in the batch, the batch\'s own opener is offered with a link to the item\'s line', () => {
  const html = render({ itemId: enrolled.itemId });
  expect(html).toContain('>Place on the map</button>');
  expect(html).toContain(`href="/studio/work/cases/${caseId}/intake"`);
  expect(html).toContain('says how many rows were placed and how many were skipped');
  expect(html).not.toContain('joins its case');
});

it('TB2: a UTF-16 table says why its rows are not placed, and offers no press', () => {
  const utf16 = { ...profile.tabular.selection, encoding: 'utf-16le' as const };
  expect(placementRefusal(utf16)).toBe(TABLE_PLACEMENT_UTF16);
  expect(placementRefusal(profile.tabular.selection)).toBeNull();
  const html = render({ refusal: placementRefusal(utf16) });
  expect(html).toContain('This table is UTF-16 text.');
  expect(html).toContain('Save the table as CSV UTF-8 and add it again');
  expect(html).not.toContain('</button>');
});
