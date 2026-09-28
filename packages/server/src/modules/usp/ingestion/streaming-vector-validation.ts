import {transaction} from '../../../infrastructure/db';

/** PostGIS/GEOS is the topology authority for one bounded, structurally valid polygon. */
export async function validateStreamingTopology(geometry:unknown):Promise<string|null>{
  try{
    return await transaction(async client=>{
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      const row=(await client.query(`SELECT ST_IsValid(g) AS valid, ST_IsEmpty(g) AS empty,
        ST_Area(g) AS area, ST_IsValidReason(g) AS reason
        FROM (SELECT ST_GeomFromGeoJSON($1) AS g) source`,[JSON.stringify(geometry)])).rows[0];
      if(row.valid&&!row.empty&&Number(row.area)>0)return null;
      return /self-intersection/i.test(String(row.reason))?'SELF_INTERSECTION':'INVALID_GEOMETRY';
    });
  }catch(error){
    // Malformed geometry input is a source issue. Connectivity and timeout failures retry the job.
    const code=(error as {code?:unknown})?.code;
    if(typeof code==='string'&&(code.startsWith('22')||code==='XX000'))return 'INVALID_GEOMETRY';
    throw error;
  }
}
