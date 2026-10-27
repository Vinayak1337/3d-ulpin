import { readFileSync, writeFileSync } from 'node:fs';

for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, 'utf8');
  const receipt = JSON.parse(text);
  const raw = `${receipt.walk.scratch}/receipt-full.json`;
  writeFileSync(raw, text, { flag: 'wx' });
  const walk = receipt.walk;
  walk.rawReceipt = raw;
  walk.calls = summarizeCalls(walk.calls ?? []);
  walk.console = (walk.console ?? []).filter(value => !['debug', 'info'].includes(value.type));
  for (const name of ['niagara', 'duplicate', 'buildings', 'largeUpload']) {
    if (walk[name]?.body) walk[name].body = walk[name].body.split('Show buildings')[0];
  }
  if (walk.reconnect?.stopped) walk.reconnect.stopped = walk.reconnect.stopped.split('Show buildings')[0];
  if (walk.gates) walk.gates = Object.fromEntries(Object.entries(walk.gates).map(([name, result]) => [name,
    result ? { task: result.task, uploadWithoutCitation: result.uploadWithoutCitation,
      reviewOutcomePublished: result.reviewOutcomePublished,
      largeFileToPackagesAutomatic: result.largeFileToPackagesAutomatic } : null]));
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
}

function summarizeCalls(calls) {
  const totals = {};
  const refusals = [];
  for (const call of calls) {
    const route = call.path.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, ':id');
    const label = `${call.method} ${route} ${call.status}`;
    totals[label] = (totals[label] ?? 0) + 1;
    if (call.status >= 400) refusals.push(call);
  }
  return { totals, refusals };
}
