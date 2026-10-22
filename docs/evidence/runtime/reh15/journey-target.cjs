const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');

// JRN2 has a fixed demo origin, not an API option. Redirect its GETs before any socket opens; deny other origins.
// This wrapper changes no product file. The command's printed API label is unchanged and is not the transport.
const original = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input, options = {}) => {
  assert.equal(typeof input, 'string', 'Only journey URL strings are permitted');
  const url = new URL(input);
  assert.equal(url.origin, 'http://127.0.0.1:3194', 'Unexpected journey origin denied before request');
  assert.equal(options.method ?? 'GET', 'GET', 'Journey writes denied before request');
  url.port = '21026';
  requests.push({ method: 'GET', target: url.origin, path: url.pathname });
  return original(url.href, options);
};
process.once('exit', () => {
  if (!requests.length) return;
  writeFileSync(`E:/BhuAayam-data/task-data/reh15/journey-transport-${process.pid}.json`, JSON.stringify({ requests }));
});
