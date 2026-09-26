import { sql } from '../../infrastructure/sql-loader';
import {transaction} from '../../infrastructure/db';
let ready:Promise<void>|undefined;
/** Additive receipt storage; canonical/source IDs live unchanged in the immutable snapshot. */
export function ensureSpatialDatasets(){
 return ready??=transaction(async client=>{
 await client.query(sql('datasets.lock'));
 await client.query(sql('datasets.schema'));
 await client.query(sql('datasets.archived-column'));
 await client.query(sql('datasets.identifier-version-column'));
 await client.query(sql('datasets.identifiers'));
 }).catch(error=>{ready=undefined;throw error;});
}
