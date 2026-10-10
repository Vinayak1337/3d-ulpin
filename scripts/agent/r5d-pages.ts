// R5d reads which cited pages of the two demo buildings have a picture. GET only: each building's canonical,
// register and ledger reads (where the Studio finds citations), then for every cited source page the
// document-pages read exactly as the Studio sends it and the raster read that the page's `url` names.
// Nothing is created: the API renders a raster on request and stores none.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base, buildingId as tower3, exchange, save } from './r2-live';

const root = 'E:/BhuAayam-data/task-data/r5d';
const buildings = [{ name: 'Tower 3', id: tower3 }, { name: 'Magnolia', id: 'e8777ffc-9409-4129-bacf-f680160d8795' }];
type Cited = { building: string; sourceId: string; sha256: string | null; revision: number | null; page: number;
  regions: string[]; citations: number; readFrom: string[] };

/** Every object that names a source and a page, wherever it sits in a read's body. */
function citations(value: any, found: any[] = []): any[] {
  if (Array.isArray(value)) value.forEach(item => citations(item, found));
  else if (value && typeof value === 'object') {
    const page = value.locator?.page ?? value.page;
    if (typeof value.sourceId === 'string' && Number.isInteger(page)) found.push({ ...value, page });
    Object.values(value).forEach(item => citations(item, found));
  }
  return found;
}

async function citedPages(building: { name: string; id: string }) {
  const pages = new Map<string, Cited>();
  for (const read of ['canonical', 'register', 'ledger']) {
    const result = await exchange(join(root, 'cited'), `${building.name.replace(' ', '').toLowerCase()}-${read}`,
      `/api/v1/buildings/${building.id}/${read}`);
    for (const cite of result.status === 200 ? citations(result.body) : []) {
      const key = `${cite.sourceId}/${cite.page}`;
      const entry: Cited = pages.get(key) ?? { building: building.name, sourceId: cite.sourceId, sha256: null,
        revision: null, page: cite.page, regions: [], citations: 0, readFrom: [] };
      entry.sha256 ??= cite.sourceSha256 ?? cite.sha256 ?? null;
      entry.revision ??= cite.sourceRevision ?? cite.revision ?? null;
      const at = cite.locator?.kind === 'region' ? cite.locator : null;
      const region = at ? JSON.stringify([at.x, at.y, at.x + at.width, at.y + at.height]) : null;
      if (region && !entry.regions.includes(region)) entry.regions.push(region);
      if (!entry.readFrom.includes(read)) entry.readFrom.push(read);
      entry.citations += 1;
      pages.set(key, entry);
    }
  }
  return [...pages.values()];
}

/** The raster read, kept as headers and a private PNG, or as the refusal the API answers. */
async function raster(name: string, path: string) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(60000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const png = response.status === 200 && response.headers.get('content-type') === 'image/png';
  const kept = ([key]: [string, string]) => key.startsWith('x-') || key === 'content-type';
  const headers = Object.fromEntries([...response.headers].filter(kept));
  const refusal = png ? null : JSON.parse(bytes.toString('utf8')).error ?? null;
  mkdirSync(join(root, 'raster'), { recursive: true });
  if (png) writeFileSync(join(root, 'raster', `${name}.png`), bytes, { flag: 'wx' });
  const result = { path, status: response.status, png, bytes: png ? bytes.length : null,
    sha256: png ? createHash('sha256').update(bytes).digest('hex') : null, headers,
    code: refusal?.code ?? null, message: refusal?.message ?? null };
  save(join(root, 'raster'), `${name}.json`, result);
  return result;
}

async function page(cited: Cited) {
  const name = `${cited.sourceId.slice(0, 8)}-p${cited.page}`;
  // The Studio sends the citation's own pins; a citation without a revision is read with revision 1.
  const revision = cited.revision ?? 1;
  const pin = `sha256=${cited.sha256}&revision=${revision}`;
  const listed = await exchange(join(root, 'pages'), name,
    `/api/v1/sources/${cited.sourceId}/pages?${pin}&offset=${cited.page - 1}&limit=1`);
  const item = listed.status === 200 ? listed.body.pages[0] : null;
  const started = Date.now();
  const unlisted = `/api/v1/sources/${cited.sourceId}/pages/${cited.page}/raster?${pin}`;
  const picture = await raster(name, item?.url ?? unlisted);
  return { ...cited, revisionSent: revision, name: listed.body.name ?? null, pagesStatus: listed.status,
    pagesCode: listed.body.error?.code ?? null, pageCount: listed.body.pageCount ?? null, frame: item?.frame ?? null,
    renderSupport: item?.renderSupport ?? null, url: item?.url ?? null, hasPicture: picture.png,
    raster: { status: picture.status, code: picture.code, message: picture.message, bytes: picture.bytes,
      sha256: picture.sha256, pixels: picture.headers['x-page-pixels'] ?? null,
      affine: picture.headers['x-page-pixel-affine'] ?? null, ms: Date.now() - started } };
}

async function main() {
  const rows = [];
  for (const building of buildings) for (const cited of await citedPages(building)) rows.push(await page(cited));
  save(root, 'cited-pages.json', rows);
  for (const row of rows) {
    console.log([row.building, row.sourceId.slice(0, 8), `page ${row.page}`, row.renderSupport ?? row.pagesCode,
      row.hasPicture ? 'picture' : `no picture (${row.raster.status} ${row.raster.code})`].join(' | '));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
