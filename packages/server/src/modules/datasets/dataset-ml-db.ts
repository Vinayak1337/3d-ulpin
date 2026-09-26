import { sql } from '../../infrastructure/sql-loader';
import {transaction} from '../../infrastructure/db';
import {ensureSpatialDatasets} from '../spatial/spatial-dataset-db';
let ready:Promise<void>|undefined;
export async function ensureDatasetMl(){await ensureSpatialDatasets();return ready??=transaction(async client=>{
 await client.query(sql('dataset-ml.lock'));
 await client.query(sql('dataset-ml.schema'));
 }).catch(e=>{ready=undefined;throw e;});}
