const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');

// REH13's journey-target.cjs for R10 part A0: JRN2 has a fixed demo origin, not an API option. Its GETs are sent to
// ulpin-reh-02 (21026) before any socket opens; other origins and writes are denied. No product file is changed.
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
  writeFileSync(`E:/BhuAayam-data/task-data/r10/journey-transport-${process.pid}.json`, JSON.stringify({ requests }));
});
