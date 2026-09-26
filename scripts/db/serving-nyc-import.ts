/** One retained official foreign footprint through the native API. No provider fetch, height mapping or Indian claim. */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { codePin, connection, hash, loadEnvironment, requireGuard, target, writeReceipt } from './serving-common';

async function main() {
  const args = process.argv.slice(2), opts = new Map<string,string>();
  while (args.length) {
    const key = args.shift()!, value = args.shift();
    requireGuard(key.startsWith('--') && value && !value.startsWith('--') && !opts.has(key), 'INVALID_ARGUMENTS');
    opts.set(key.slice(2),value);
  }
  const get = (key: string) => { const value = opts.get(key); requireGuard(value, `REQUIRED_${key.toUpperCase().replaceAll('-','_')}`); return value; };
  const out = get('out'); requireGuard(!existsSync(out), 'RECEIPT_ALREADY_EXISTS');
  const env = loadEnvironment(get('env-file'));
  const receipt: Record<string,unknown> = { version: 'serving-nyc-import/1', status: 'running', codeCommit: codePin(),
    startedAt: new Date().toISOString(), mutationAttempted: false, geography: 'New York City, USA', purpose: 'test_only' };
  const p = connection(env.env.DATABASE_URL,true); p.on('error',() => {});
  const client = await p.connect();
  try {
    requireGuard(!execFileSync('git',['status','--porcelain'],{encoding:'utf8',timeout:5000}).trim(), 'CLEAN_PINNED_CHECKOUT_REQUIRED');
    requireGuard(codePin() === get('expect-code'), 'CODE_PIN_CHANGED');
    requireGuard((await target(client,env.endpoint)).token === get('expect-target'), 'LIVE_TARGET_CHANGED');
    const api = new URL(get('api'));
    requireGuard(api.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(api.hostname) &&
      !api.username && !api.password && !api.search && !api.hash && api.pathname === '/api/v1', 'EXACT_LOOPBACK_API_REQUIRED');
    async function call(path: string, options: RequestInit = {}) {
      const response = await fetch(api.href+path,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
      requireGuard(response.ok, `API_HTTP_${response.status}`);
      const length = Number(response.headers.get('content-length') || 0);
      requireGuard(length <= 8*1024*1024, 'API_RESPONSE_BOUND');
      const chunks: Uint8Array[] = []; let count = 0;
      requireGuard(response.body, 'API_BODY_REQUIRED');
      const reader = response.body.getReader();
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          count += item.value.length;
          if (count > 8*1024*1024) { await reader.cancel(); requireGuard(false,'API_RESPONSE_BOUND'); }
          chunks.push(item.value);
        }
      } finally { reader.releaseLock(); }
      return { response, bytes: Buffer.concat(chunks,count) };
    }
    const health = JSON.parse((await call('/health')).bytes.toString('utf8'));
    requireGuard(health.ok === true && health.databaseReadiness?.schema?.ready === true &&
      health.databaseReadiness.schema.targetToken === get('expect-target') &&
      health.databaseReadiness.schema.manifestSha256 === get('expect-manifest'), 'API_TARGET_SCHEMA_OR_HEALTH_MISMATCH');
    const original = readFileSync('fixtures/real-nyc/original.geojson');
    const manifestBytes = readFileSync('fixtures/real-nyc/provenance.json');
    const provenance = JSON.parse(manifestBytes.toString('utf8'));
    requireGuard(hash(original) === provenance.originalSha256 && original.length === 1763 &&
      provenance.originalSha256 === '6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda', 'RETAINED_OFFICIAL_SOURCE_CHANGED');
    const native = JSON.parse(original.toString('utf8'));
    requireGuard(native.features.length === 1 && String(native.features[0].properties.doitt_id) === provenance.sourceKey.doitt_id &&
      native.features[0].geometry.type === 'MultiPolygon', 'NYC_FOOTPRINT_PROFILE_CHANGED');
    const fields = { format: 'geojson', namespace: 'nyc-oti-5zhs-2jue', name: `NYC OTI building footprint ${provenance.sourceKey.doitt_id}`,
      mapping: JSON.stringify({idField:'doitt_id',kind:'building',geometryRole:'unknown'}), sourceCrs:'EPSG:4326',worldStatus:'observed' };
    const form = (includeFields: boolean) => {
      const body = new FormData(); body.set('file',new Blob([original],{type:'application/geo+json'}),'original.geojson');
      if (includeFields) for (const [key,value] of Object.entries(fields)) body.set(key,value);
      return body;
    };
    const inspected = JSON.parse((await call('/import-packages/inspect',{method:'POST',body:form(false)})).bytes.toString('utf8'));
    requireGuard(inspected.sourceSha256 === hash(original) && inspected.featureCount === 1 && inspected.sourceCrs === 'EPSG:4326', 'OFFICIAL_PROFILE_INSPECTION_MISMATCH');
    const prior = (await client.query(`SELECT id FROM import_packages WHERE body->>'sourceHash'=$1 AND
      body->>'datasetNamespace'=$2 AND body->>'name'=$3`,[hash(original),fields.namespace,fields.name])).rows;
    requireGuard(prior.length <= 1, 'EXISTING_IMPORT_AMBIGUOUS');
    receipt.mutationAttempted = true;
    const pkg = JSON.parse((await call('/import-packages',{method:'POST',body:form(true)})).bytes.toString('utf8'));
    requireGuard(!prior.length || pkg.id === prior[0].id, 'IMPORT_REPEAT_CHANGED_PACKAGE');
    const saved = (await client.query('SELECT body FROM import_packages WHERE id=$1',[pkg.id])).rows[0]?.body;
    requireGuard(saved && saved.sourceHash === hash(original) && saved.features.length === 1 && saved.sourceRevisionIds.length === 1,
      'API_DATABASE_PUBLICATION_MISMATCH');
    const read = JSON.parse((await call(`/import-packages/${pkg.id}`)).bytes.toString('utf8'));
    const feature = read.features[0];
    requireGuard(read.sourceHash === hash(original) && read.id === pkg.id && read.features.length === 1 &&
      feature.sourceKey === provenance.sourceKey.doitt_id && feature.sourceRevisionId === saved.sourceRevisionIds[0] &&
      feature.geometryRole === 'unknown' && feature.height.value === null, 'SOURCE_READ_OR_UNKNOWN_HEIGHT_MISMATCH');
    const area = JSON.parse((await call(`/areas/${pkg.areaId}/context`)).bytes.toString('utf8'));
    requireGuard(area.packages.some((p: {id: string}) => p.id === pkg.id), 'MAP_AREA_READ_MISSING');
    const downloaded = await call(`/sources/${saved.sourceRevisionIds[0]}/file`);
    requireGuard(downloaded.bytes.equals(original) && downloaded.response.headers.get('cache-control') === 'private, max-age=60' &&
      downloaded.response.headers.get('x-content-type-options') === 'nosniff', 'ORIGINAL_DOWNLOAD_OR_PRIVACY_MISMATCH');
    const denied = await fetch(api.href+`/sources/${saved.sourceRevisionIds[0]}/file`,
      {headers:{Origin:new URL(provenance.terms).origin},redirect:'error',signal:AbortSignal.timeout(10000)});
    requireGuard(denied.status === 403, 'REMOTE_ORIGIN_READ_NOT_DENIED');
    receipt.status = 'passed'; receipt.repeat = prior.length === 1;
    receipt.source = { originalSha256: hash(original), bytes: original.length, manifestSha256: hash(manifestBytes),
      issuer: provenance.provider, originalUrl: provenance.originalDownload, terms: provenance.terms, crs:'EPSG:4326',
      limitations: 'One foreign 2D footprint; geometry role unknown; no height mapped, interior, ownership, official ULPIN, Indian suitability or scale claim.' };
    receipt.read = { packageId: pkg.id, areaId: pkg.areaId, sourceId: saved.sourceRevisionIds[0], featureId: feature.id,
      packageState: read.state, height: 'unknown', originalHashPreserved: true, privateDownload: true, remoteOriginDenied: true };
  } catch (error) {
    receipt.status = 'failed'; const code = (error as {code?: string}).code;
    receipt.errorCode = code && /^[A-Z0-9_]+$/.test(code) ? code : 'IMPORT_VERIFICATION_FAILURE';
    receipt.recovery = 'Keep source/package history. Recheck exact target and existing package before API retry; never reset or delete an uncertain publication.';
    process.exitCode = 1;
  } finally {
    client.release(); await p.end(); receipt.completedAt = new Date().toISOString(); writeReceipt(out,receipt);
    console.log(JSON.stringify({status:receipt.status,receipt:out,errorCode:receipt.errorCode,mutationAttempted:receipt.mutationAttempted}));
  }
}
try { await main(); }
catch { console.error('SERVING_IMPORT_CONFIGURATION_FAILED'); process.exitCode = 1; }
