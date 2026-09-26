WITH bounds AS MATERIALIZED (
  SELECT ST_TileEnvelope($3,$4,$5) box,ST_Transform(ST_TileEnvelope($3,$4,$5,margin=>64.0/4096),4326) halo
), candidates AS MATERIALIZED (
  SELECT o.feature_index,o.unit_id,o.raw_ref->>'sha256' raw_sha,o.geographic_ref->>'sha256' geo_sha,
    (u.native_key->>'value')::bigint mvt_id,
    ST_AsMVTGeom(ST_Transform(o.geographic_geometry,3857),bounds.box,4096,64,true) clipped
  FROM administrative_unit_observations o JOIN administrative_units u ON u.id=o.unit_id CROSS JOIN bounds
  WHERE o.job_id=$1 AND o.source_id=$2 AND o.disposition='admitted' AND ($6::int IS NULL OR o.committed_chunk_sequence<=$6) AND ST_SRID(o.geographic_geometry)=4326
    AND u.native_key->>'type'='number' AND o.geographic_geometry && bounds.halo
  ORDER BY o.feature_index LIMIT 734
), kept AS MATERIALIZED (
  SELECT mvt_id,unit_id::text unit_id,ST_CollectionExtract(clipped,3) geom FROM candidates
  WHERE clipped IS NOT NULL AND NOT ST_IsEmpty(clipped) AND ST_Dimension(clipped)=2
), encoded AS (
  SELECT ST_AsMVT(kept.*,'nwic_districts',4096,'geom','mvt_id' ORDER BY mvt_id) bytes FROM kept WHERE NOT ST_IsEmpty(geom)
)
SELECT encoded.bytes,(SELECT count(*)::int FROM candidates) candidates,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('mvtId',c.mvt_id,'unitId',c.unit_id,'featureIndex',c.feature_index,
    'rawSha256',c.raw_sha,'geographicSha256',c.geo_sha) ORDER BY c.feature_index)
    FROM candidates c JOIN kept k ON k.mvt_id=c.mvt_id WHERE NOT ST_IsEmpty(k.geom)),'[]'::jsonb) features,
  ARRAY[ST_XMin(bounds.box),ST_YMin(bounds.box),ST_XMax(bounds.box),ST_YMax(bounds.box)] bounds
FROM encoded CROSS JOIN bounds;
