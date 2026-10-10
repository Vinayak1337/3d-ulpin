type ExteriorBody = { representation?: unknown; footprint?: unknown; geometry?: unknown };

/** Citation-only observations must not qualify as detailed coordinates. */
export function isExteriorOnly(body: ExteriorBody): boolean {
  return body.representation === 'physical_exterior'
    && Array.isArray(body.footprint) && body.footprint.length === 0
    && (body.geometry === undefined || body.geometry === null);
}

/** COALESCE keeps missing JSON fields from disappearing under SQL NOT. */
export function exteriorOnlySql(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid registry table alias.');
  return `COALESCE(${alias}.body->>'representation' = 'physical_exterior'`
    + ` AND ${alias}.body->'footprint' = '[]'::jsonb`
    + ` AND COALESCE(${alias}.body->'geometry', 'null'::jsonb) = 'null'::jsonb, false)`;
}
