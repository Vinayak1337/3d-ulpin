import type {PoolClient} from 'pg';
/** Published failed/stale jobs retain their completed-history charge. EXISTS
 * counts a job once regardless of the number of immutable generation versions. */
export async function privateMvtCapacityTx(client:PoolClient){
  return (await client.query(`SELECT count(*)::int jobs,count(*) FILTER(WHERE j.status IN('queued','running'))::int active,
    count(*) FILTER(WHERE j.status IN('queued','running','succeeded') OR EXISTS(
      SELECT 1 FROM usp_display.source_tile_generations g WHERE g.job_id=j.id))::int history
    FROM jobs j WHERE j.operation='private-mvt'`)).rows[0] as {jobs:number;active:number;history:number};
}
