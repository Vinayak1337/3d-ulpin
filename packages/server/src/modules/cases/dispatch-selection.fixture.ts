import { DatabaseSync } from 'node:sqlite';

export type SelectionFixtureJob = { id: string; operation: string; source_id: string; case_id: string;
  created_at: Date; status?: string; itemCreated?: number; pinned?: boolean; wave?: number;
  placement?: string; recipeState?: string; parts?: number; itemId?: string; family?: string;
  partState?: string };

/** Execute the tick's window ordering offline, translating only PostgreSQL array joins/casts to SQLite equivalents.
 * This does not qualify PostgreSQL planning, timestamp types, locks or performance. No application database opens. */
export function dispatchFixtureSelection(sql: string, values: unknown[], jobs: SelectionFixtureJob[]) {
  const db = new DatabaseSync(':memory:');
  try {
    db.function('now', () => new Date().toISOString());
    createTables(db);
    insertLanes(db, values);
    insertJobs(db, jobs);
    const parameters = Object.fromEntries(values.slice(2).map((value, index) =>
      [`$${index + 3}`, JSON.stringify(value)]));
    return db.prepare(sqliteSelection(sql)).all(parameters);
  } finally {
    db.close();
  }
}

function sqliteSelection(sql: string) {
  return sql.replace('unnest($1::text[],$2::text[]) AS lanes(operation,lane)', 'dispatch_lanes AS lanes')
    .replace(/::text(?:\[\])?/g, '').replaceAll('bool_or(', 'max(')
    .replace(/(COALESCE\([^)]*\)|[\w.]+)=ANY\(\$(\d)\)/g,
      (_match, column: string, parameter: string) => `${column} IN (SELECT value FROM json_each($${parameter}))`);
}

function createTables(db: DatabaseSync) {
  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY,operation TEXT,source_id TEXT,case_id TEXT,created_at TEXT,
      status TEXT,next_attempt_at TEXT,dispatched_at TEXT,payload TEXT,attempts INTEGER DEFAULT 0);
    CREATE TABLE usp_intake_items (source_id TEXT,case_id TEXT,parent_item_id TEXT,created_at TEXT,
      pinned_by_officer INTEGER,wave INTEGER,placement TEXT,plan_ref TEXT,item_id TEXT,family TEXT,
      PRIMARY KEY(source_id,case_id));
    CREATE TABLE usp_intake_parts (item_id TEXT,state TEXT);
    CREATE TABLE usp_job_attempts (job_id TEXT,state TEXT,lease_until TEXT);
    CREATE TABLE dispatch_lanes (operation TEXT,lane TEXT);`);
}

function insertLanes(db: DatabaseSync, values: unknown[]) {
  const insert = db.prepare('INSERT INTO dispatch_lanes VALUES(?,?)');
  const operations = values[0] as string[], lanes = values[1] as string[];
  operations.forEach((operation, index) => insert.run(operation, lanes[index]));
}

function insertJobs(db: DatabaseSync, jobs: SelectionFixtureJob[]) {
  const insert = db.prepare(`INSERT INTO jobs(id,operation,source_id,case_id,created_at,status,next_attempt_at,payload)
    VALUES(?,?,?,?,?,?,?,?)`);
  const item = db.prepare('INSERT OR IGNORE INTO usp_intake_items VALUES(?,?,NULL,?,?,?,?,?,?,?)');
  const part = db.prepare('INSERT INTO usp_intake_parts VALUES(?,?)');
  for (const row of jobs) {
    insert.run(row.id, row.operation, row.source_id, row.case_id, row.created_at.toISOString(), row.status ?? 'queued',
      new Date(0).toISOString(), JSON.stringify({ itemId: row.itemId ?? row.source_id }));
    if (row.itemCreated === undefined) continue;
    item.run(row.source_id, row.case_id, new Date(row.itemCreated).toISOString(), Number(row.pinned ?? false),
      row.wave ?? 1, row.placement ?? 'undecided', row.recipeState ? JSON.stringify({ recipeState: row.recipeState })
        : null, row.itemId ?? row.source_id, row.family ?? 'unknown');
    if (row.parts || row.placement === 'on_map') part.run(row.itemId ?? row.source_id, row.partState ?? 'published');
  }
}
