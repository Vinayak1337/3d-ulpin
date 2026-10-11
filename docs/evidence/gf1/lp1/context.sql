WITH selected AS MATERIALIZED (
  SELECT id FROM physical_features
  WHERE area_id=$1 AND revision>0 AND id<>ALL($13::uuid[])
    AND geometry && ST_MakeEnvelope($2,$3,$4,$5,0)
    AND ST_Intersects(geometry,ST_MakeEnvelope($2,$3,$4,$5,0))
  UNION
  SELECT id FROM physical_features
  WHERE area_id<>$1 AND revision>0 AND id<>ALL($13::uuid[])
    AND $14::boolean AND body->>'worldStatus' IN ('observed','planned')
    AND geographic_geometry && ST_MakeEnvelope($6,$7,$8,$9,4326)
    AND ST_Intersects(geographic_geometry,ST_MakeEnvelope($6,$7,$8,$9,4326))
  UNION
  SELECT f.id FROM property_associations a JOIN physical_features f ON f.id=a.to_id
  WHERE a.from_id=ANY($13::uuid[]) AND a.relationship='occupies_parcel' AND a.status='confirmed'
    AND f.revision>0 AND f.id<>ALL($13::uuid[])
  UNION
  SELECT f.id FROM block_groups g JOIN block_group_memberships m ON m.group_id=g.id
  JOIN physical_features f ON f.id=m.feature_id
  WHERE g.area_id=$1 AND f.area_id<>$1 AND f.revision>0 AND f.id<>ALL($13::uuid[])
)
SELECT f.body,f.area_id,q.qualification_revision,q.metadata,
  CASE WHEN f.area_id<>$1 AND $10::integer IS NOT NULL THEN
    ST_AsGeoJSON(ST_Translate(ST_Transform(f.geographic_geometry,$10::integer),
      -($11::double precision),-($12::double precision)),9,0) END local_geometry,
  count(*) OVER() AS context_count
FROM selected s JOIN physical_features f ON f.id=s.id
JOIN LATERAL (SELECT qualification_revision,metadata FROM usp_analytic_geometry
  WHERE namespace='area_feature' AND id=f.id AND revision=f.revision OFFSET 0) q ON true
ORDER BY f.id LIMIT 2001
