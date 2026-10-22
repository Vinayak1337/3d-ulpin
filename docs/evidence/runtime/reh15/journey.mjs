import { run, save, serving } from './audit.mjs';

// JRN2 against the rehearsal API: the wrapper redirects its GETs from the demo origin to 21026 and denies writes.
const caseId = '6e38560f-077a-4f70-bc0c-997e0c57e3ca';
const wrapper = 'E:/Projects/ulpin-wt/k3/docs/evidence/runtime/reh15/journey-target.cjs';
const receipt = run(`set "NODE_OPTIONS=--require ${wrapper}" && pnpm journey:check --case ${caseId} `
  + '--output E:/BhuAayam-data/task-data/reh15/journey-final.json', serving, 300000);
save('journey-command.json', receipt);
console.log(receipt.output.join('\n'));
process.exitCode = receipt.exit ?? 1;
