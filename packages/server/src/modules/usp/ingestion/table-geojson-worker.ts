import { derivativeKeeping, runDerivativeJob, type DerivativeJob } from './intake-native-derivative-worker';
import { IntakeTableGeojsonInputSchema, besideTableWords, openTableOriginal, placeTableRows,
  type IntakeTableGeojsonInput } from './table-geojson';

/** TC1. The dispatcher's fenced job: the table's rows written as a GeoJSON derivative, kept and enrolled. */
export const tableGeojsonJob: DerivativeJob<IntakeTableGeojsonInput> = { operation: 'intake-table-geojson',
  parse: payload => IntakeTableGeojsonInputSchema.parse(payload),
  run: input => placeTableRows(input, { ...derivativeKeeping, open: openTableOriginal }),
  stopped: (code, current) => besideTableWords(current,
    `Placing the rows of this table on the map stopped (${code}); place them again to retry.`),
  failedCode: 'TABLE_PLACEMENT_FAILED' };

export function runIntakeTableGeojsonJob(jobId: string) {
  return runDerivativeJob(jobId, tableGeojsonJob);
}
