import assert from 'node:assert/strict';
import { Reader } from '../../../../scripts/golden-journey/read';

// Negative command: the expected refusal exits 1. The stub guarantees no live HTTP request can occur.
async function main() {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error('Unexpected network request');
  };
  try {
    await new Reader().postRead('/api/v1/usp/identity/assign', {});
  } catch (error) {
    assert(error instanceof Error);
    assert.equal(requests, 0);
    assert.match(error.message, /^POST refused before request:/);
    console.error(error.message);
    console.log(`network requests=${requests}`);
    process.exitCode = 1;
    return;
  }
  throw new Error('Non-listed POST was accepted');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Refusal check failed');
  process.exitCode = 2;
});
