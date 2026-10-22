import {transaction} from '../../../infrastructure/db';

/** PostGIS/GEOS validates a bounded geometry; only polygonal geometry requires positive area. */
export async function validateStreamingTopology(geometry:unknown):Promise<string|null>{
  try{
    return await transaction(async client=>{
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      const row=(await client.query(`SELECT ST_IsValid(g) AS valid, ST_IsEmpty(g) AS empty,
        ST_Area(g) AS area, ST_Length(g) AS length, ST_Dimension(g) AS dimension, ST_IsValidReason(g) AS reason
        FROM (SELECT ST_GeomFromGeoJSON($1) AS g) source`,[JSON.stringify(geometry)])).rows[0];
      const positive=row.dimension===0||row.dimension===1&&Number(row.length)>0
        ||row.dimension===2&&Number(row.area)>0;
      if(row.valid&&!row.empty&&positive)return null;
      return /self-intersection/i.test(String(row.reason))?'SELF_INTERSECTION':'INVALID_GEOMETRY';
    });
  }catch(error){
    // Malformed geometry input is a source issue. Connectivity and timeout failures retry the job.
    const code=(error as {code?:unknown})?.code;
    if(typeof code==='string'&&(code.startsWith('22')||code==='XX000'))return 'INVALID_GEOMETRY';
    throw error;
  }
}
