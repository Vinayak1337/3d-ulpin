import { profileColumnFile } from '../../packages/server/src/modules/usp/ingestion/column-profile';
const args = process.argv.slice(2),
  path = args[0],
  sheetIndex = args.indexOf('--sheet'),
  headerIndex = args.indexOf('--header-row');
if (!path) throw new Error('Usage: profile-columns.ts <file> [--sheet <name>]');
if (sheetIndex >= 0 && !args[sheetIndex + 1]) throw new Error('--sheet requires an exact sheet name');
console.log(
  JSON.stringify(
    profileColumnFile(
      path,
      sheetIndex >= 0 ? args[sheetIndex + 1] : undefined,
      headerIndex >= 0 ? Number(args[headerIndex + 1]) : undefined,
    ).profile,
    null,
    2,
  ),
);
