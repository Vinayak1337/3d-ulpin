import { save } from './audit.mjs';

// RV1 by GET only: the citation read of each act 1 record at revision 1 and 2, and of two revision-1 reads REH14
// saw refused with 422. Status, revision and the number of register row excerpts; bodies are not kept.
const api = 'http://127.0.0.1:21026/api/v1/registry-records';
const reads = [
  ['REH15 cited 1002842', 'e5bcd7fd-9f90-4485-a883-c93a265ae63c', 1],
  ['REH15 cited 1002842', 'e5bcd7fd-9f90-4485-a883-c93a265ae63c', 2],
  ['REH15 footprint-only 1007046', '6fd646ab-5230-4e4e-8088-df2fcefaf05f', 1],
  ['REH14 footprint-only 1001693', '4d051593-b4ba-4661-a7a5-a907e6b3fc3f', 1],
  ['REH14 cited 1001925', '37080b64-a8cd-49f7-a31e-cb3646217310', 1],
];

async function read([label, id, revision]) {
  const response = await fetch(`${api}/${id}/revisions/${revision}/document-citations`,
    { signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  const data = body.data ?? body;
  const excerpts = (data.citations ?? []).filter(row => row.pin?.version === 'registry-table-row-citation/1'
    && row.pin.excerpt !== undefined).length;
  return { label, record: id.slice(0, 8), revision, status: response.status, code: body.error?.code ?? null,
    citations: data.citations?.length ?? null, excerpts };
}

const rows = [];
for (const entry of reads) rows.push(await read(entry));
save('citations-read.json', { at: new Date().toISOString(), method: 'GET', rows });
console.log(JSON.stringify(rows));
