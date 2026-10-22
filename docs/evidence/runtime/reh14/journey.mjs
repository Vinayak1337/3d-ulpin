import { run, save, serving } from './audit.mjs';

// JRN2 against the rehearsal API: the wrapper redirects its GETs from the demo origin to 21026 and denies writes.
const caseId = '0f993395-860b-4dae-8873-9f1a149d8be7';
const wrapper = 'E:/Projects/ulpin-wt/k3/docs/evidence/runtime/reh14/journey-target.cjs';
const receipt = run(`set "NODE_OPTIONS=--require ${wrapper}" && pnpm journey:check --case ${caseId} `
  + '--output E:/BhuAayam-data/task-data/reh14/journey-final.json', serving, 300000);
save('journey-command.json', receipt);
console.log(receipt.output.join('\n'));
process.exitCode = receipt.exit ?? 1;
