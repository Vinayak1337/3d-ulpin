import { readFileSync, writeFileSync } from 'node:fs';

// Send a single presenter action to the unchanged REH10 browser harness; retain its complete receipt in scratch.
const [step, file] = process.argv.slice(2);
const code = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
const response = await fetch('http://127.0.0.1:5399', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step, code }),
});
const value = await response.json();
writeFileSync(`E:/BhuAayam-data/task-data/reh14/${step}.json`, JSON.stringify(value, null, 2));
console.log(JSON.stringify(value));
process.exitCode = value.ok ? 0 : 1;
