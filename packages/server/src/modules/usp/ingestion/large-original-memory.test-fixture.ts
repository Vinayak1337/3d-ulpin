import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Pool } from 'pg';
import { largeOriginalStorage } from './large-original';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Row = Record<string, any>;

/** What the package rule reads about one case: its packages, a property link and the sources its batch items hold. */
export type MemoryCase = { id: string; revision: number; archived: boolean;
  packages: { id: string; state: string; source_ids: unknown }[]; properties: string[]; batchSources: Set<string> };

/**
 * Only the statements v1 byte and manual receipts send, over one case; anything else fails the test. `sources`
 * may be a caller's map, so a job's own ledger finds the originals the receipt keeps.
 */
export function memoryPool(caseId: string, sources = new Map<string, Row>()) {
  const db = { case: { id: caseId, revision: 0, archived: false, packages: [], properties: [],
    batchSources: new Set() } as MemoryCase, uploads: [] as Row[], parts: [] as Row[], sources,
    operations: new Map<string, Row>() };
  let sequence = 0;
  const result = (rows: Row[]) => ({ rows, rowCount: rows.length });
  const run = async (sql: string, values: any[] = []) => {
    const upload = () => db.uploads.filter(row => row.id === values[0]);
    const part = () => db.parts.filter(row => row.upload_id === values[0] && row.part_number === values[1]);
    if (/^(BEGIN|START|COMMIT|ROLLBACK|SET)|pg_advisory_xact_lock|INSERT INTO usp_outbox/.test(sql)) return result([]);
    if (sql.includes('FROM registry_case_feature_mappings')) return result(db.case.properties.map(id => ({ id })));
    if (sql.startsWith('SELECT a.name FROM cases c JOIN map_areas')) return result([]);
    if (sql.includes('FROM import_packages')) return result(db.case.packages);
    if (sql.startsWith('SELECT source_id FROM usp_intake_items WHERE case_id=$1'))
      return result(values[0] === db.case.id ? [...db.case.batchSources].map(source_id => ({ source_id })) : []);
    if (sql.includes('FROM cases WHERE id=$1')) return result([db.case]);
    if (sql.startsWith('UPDATE cases SET revision=revision+1')) { db.case.revision++; return result([]); }
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) return result([...db.sources.values()]);
    if (sql.startsWith('SELECT payload_hash,result FROM operations')) {
      const prior = db.operations.get(values[1]);
      return result(prior ? [prior] : []);
    }
    if (sql.startsWith('INSERT INTO operations')) {
      db.operations.set(values[1], { payload_hash: values[2], result: values[3] });
      return result([]);
    }
    if (/^SELECT (?:id|id,revision|\*) FROM sources WHERE case_id=/.test(sql)) {
      return result([...db.sources.values()].filter(row => row.case_id === values[0] && row.sha256 === values[1]
        && row.profile === values[2] && (!sql.includes("inspection ? 'manualProfile'")
          || row.inspection?.manualProfile)));
    }
    if (sql.startsWith('SELECT * FROM sources WHERE id=') || sql.startsWith('SELECT id FROM sources WHERE id=')) {
      const row = db.sources.get(values[0]);
      return result(row ? [row] : []);
    }
    if (sql.startsWith('SELECT max(revision)')) return result([{ revision: 1 }]);
    if (sql.startsWith('SELECT id FROM sources')) return result([]);
    if (sql.startsWith('INSERT INTO sources')) {
      if (values.length === 11) {
        const keys = ['id', 'case_id', 'family_id', 'revision', 'name', 'profile', 'mime_type', 'bytes',
          'sha256', 'object_key', 'inspection'];
        db.sources.set(values[0], Object.fromEntries(keys.map((key, index) => [key, values[index]])));
      } else {
        db.sources.set(values[0], { id: values[0], name: values[2], sha256: values[5], object_key: values[6],
          inspection: values[7] });
      }
      return result([]);
    }
    if (sql.startsWith('UPDATE sources SET mime_type=')) {
      const row = db.sources.get(values[0])!;
      row.mime_type = values[1];
      row.inspection = { ...row.inspection, ...JSON.parse(values[2]) };
      return result([]);
    }
    if (sql.startsWith('UPDATE usp_outbox_streams')) return result([{ sequence: String(++sequence) }]);
    if (sql.includes('FROM usp_source_uploads WHERE case_id=$1 AND operator_subject')) return result([]);
    if (sql.includes('count(*) FILTER')) return result([{ held: 0, case_held: 0, operator_held: 0, held_bytes: '0',
      case_bytes: '0', frees_at: null, case_frees_at: null, operator_frees_at: null, v1_held_bytes: '0',
      v2_held_bytes: '0', retained_bytes: '0', leftover_bytes: '0' }]);
    if (sql.startsWith('INSERT INTO usp_source_uploads')) {
      const row = { id: values[0], case_id: values[1], operator_subject: values[2], request_key: values[3],
        request_hash: values[4], revision: 1, case_revision: values[5], state: 'receiving', source_id: values[6],
        original_bytes: String(values[7]), body: values[8], expires_at: values[9], lease_token: null,
        lease_expires_at: null, finalize_attempts: 0 };
      db.uploads.push(row);
      return result([row]);
    }
    if (sql.startsWith('SELECT * FROM usp_source_uploads WHERE id=$1')) return result(upload());
    if (sql.startsWith('UPDATE usp_source_uploads SET')) {
      Object.assign(upload()[0]!, { revision: values[1], case_revision: values[2], state: values[3], body: values[4],
        lease_token: values[5], lease_expires_at: values[6], finalize_attempts: values[7] });
      return result([]);
    }
    if (sql.startsWith('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 ORDER BY')
      || sql.startsWith('SELECT object_key FROM usp_source_upload_parts'))
      return result(db.parts.filter(row => row.upload_id === values[0]));
    if (sql.startsWith('SELECT * FROM usp_source_upload_parts WHERE upload_id=$1 AND part_number=$2')) {
      return result(part());
    }
    if (sql.includes("state='writing' AND lease_token=$3")) {
      const rows = part().filter(row => row.state === 'writing' && row.lease_token === values[2]);
      if (sql.startsWith('UPDATE')) rows.forEach(row => Object.assign(row, { state: 'received', lease_token: null }));
      return result(rows);
    }
    if (sql.startsWith('SELECT 1 FROM usp_source_upload_parts') || sql.startsWith('SELECT part_number')) {
      return result([]);
    }
    if (sql.startsWith('INSERT INTO usp_source_upload_parts')) {
      db.parts.push({ upload_id: values[0], part_number: values[1], request_key: values[2], sha256: values[3],
        bytes: values[4], object_key: values[5], state: 'writing', attempts: 1, lease_token: values[6],
        lease_expires_at: values[7] });
      return result([]);
    }
    throw new Error(`Statement outside this protocol: ${sql.slice(0, 80)}`);
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => undefined }) };
  return { db, pool: pool as unknown as Pool };
}

export function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const missing = Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
  const storage: typeof largeOriginalStorage = { ...largeOriginalStorage,
    assertLargeOriginalStorageProfile: async () => undefined,
    putPartObject: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); },
    readPartObject: async (key: string) => objects.get(key)!,
    putOriginalStream: async (key: string, body: Readable) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) chunks.push(chunk);
      objects.set(key, Buffer.concat(chunks));
    },
    verifyObjectStream: async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw missing;
      return { etag: 'memory-etag', sha256: sha(bytes), bytes: bytes.length };
    },
    sealUploadObject: async () => undefined, abortOriginalAssemblies: async () => undefined,
  } as never;
  return { objects, storage };
}

/** Runs `work` with the receipt's statements answered by `pool`, as the service's own transactions use it. */
export async function withPool<T>(pool: Pool, work: () => Promise<T>): Promise<T> {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const prior = globals.ulpinPool;
  globals.ulpinPool = pool;
  try {
    return await work();
  } finally {
    globals.ulpinPool = prior;
  }
}
