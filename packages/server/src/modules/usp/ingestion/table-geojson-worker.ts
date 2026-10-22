import { derivativeKeeping, runDerivativeJob } from './intake-native-derivative-worker';
import { IntakeTableGeojsonInputSchema, openTableOriginal, placeTableRows } from './table-geojson';

/** TC1. The dispatcher's fenced job: the table's rows written as a GeoJSON derivative, kept and enrolled. */
export function runIntakeTableGeojsonJob(jobId: string) {
  return runDerivativeJob(jobId, { operation: 'intake-table-geojson',
    parse: payload => IntakeTableGeojsonInputSchema.parse(payload),
    run: input => placeTableRows(input, { ...derivativeKeeping, open: openTableOriginal }),
    stopped: code => `Placing the rows of this table on the map stopped (${code}); place them again to retry.` });
}
