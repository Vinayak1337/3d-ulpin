import { z } from 'zod';
import { UspExchangeCompareSchema, UspExchangeExportSchema,
  normalizeProjectCode, type RequestContext, type SnapshotScope, type TargetPin } from '@ulpin/contracts/usp';
import { canonical, fingerprint } from '../cases/domain';
import { AppError } from '../../infrastructure/errors';
import { sha256 } from '../../infrastructure/storage';
import { assertLocalUsp, readManifest, readSnapshotBody,readSnapshotOriginal,registryDocumentSnapshotView } from './snapshots';

type Json = Record<string, any>;
type Source = { id: string; revision: number; sha256: string; licenceFamily: string | null;
  bodySha256: string; metadata: Json };
type ExchangeRecord = { id: string; pin: TargetPin; bodySha256: string; body: Json;
  sourceIds: string[]; licenceFamily: string | null };
type Loss = { objectId: string | null; field: string; category: 'unsupported' | 'omitted_by_profile' | 'withheld'; reason: string };
type Comparison = { objectId: string | null; field: string;
  category: 'exact' | 'normalized_equivalent' | 'omitted_by_profile' | 'unsupported' | 'withheld' | 'conflict';
  detail?: string };

const uuid = z.uuid();
const shape = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const objectType = (kind: string): 'Building' | 'BuildingStorey' | 'BuildingUnit' | null =>
  kind === 'building' ? 'Building' : kind === 'floor' ? 'BuildingStorey' : kind === 'space' ? 'BuildingUnit' : null;
const isShareAlike = (family: string) => /(?:odbl|cc[ -]?by[ -]?sa|share[ -]?alike)/i.test(family);

function bindings(body: Json): string[] {
  const b = body.body ?? body;
  const refs = [...(Array.isArray(b.evidence) ? b.evidence : []),
    ...(Array.isArray(b.rights) ? b.rights.map((right: Json) => right.evidence) : []),
    ...(shape(b.geometry?.bindings) ? Object.values(b.geometry.bindings) : [])];
  const ids = refs.filter(shape).map(ref => ref.sourceId).filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
}

function sourceLicence(body: Json): string | null {
  const candidate = body.licenceFamily ?? body.licence_family ?? body.inspection?.licenceFamily
    ?? body.inspection?.licence_family;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function assertFrame(site: Json): { horizontal: string; vertical: string; unit: string } {
  const frame = site.frame;
  if (!shape(frame) || typeof frame.id !== 'string' || !/^EPSG:[1-9][0-9]{2,6}$/.test(frame.id)
    || typeof frame.benchmark !== 'string' || !frame.benchmark.trim()
    || frame.horizontalUnit !== 'm' || frame.verticalUnit !== 'm') {
    throw new AppError(422, 'USP_EXCHANGE_FRAME', 'An exact EPSG frame and named vertical reference are required.');
  }
  return { horizontal: frame.id, vertical: frame.benchmark, unit: 'm' };
}

function mapping(records: ExchangeRecord[], cityObjects: Json, losses: Loss[]) {
  const rows: { objectId: string; field: string; role: string; coverage: 'mapped' | 'extension' | 'unsupported' | 'withheld' }[] = [];
  for (const record of records) {
    const body = record.body.body ?? record.body;
    const visible = !!cityObjects[record.id];
    for (const [field, role] of [['id', 'Administrative unit/structure identity'],
      ['body.rights', 'RRR and party assertion'], ['body.evidence', 'Spatial/administrative source'],
      ['body.links', 'Level/structure association'], ['body.geometry', 'Legal space candidate']]) {
      const present = field === 'id' || field.split('.').slice(1).reduce((value: any, key) => value?.[key], body) !== undefined;
      rows.push({ objectId: record.id, field, role,
        coverage: !visible ? 'unsupported' : !present ? 'unsupported' : field === 'id' ? 'mapped' : 'extension' });
    }
  }
  return { profile: 'P3-LADM/1', basis: 'conceptual field mapping; no ISO conformance or legal conclusion',
    fields: rows, unmapped: losses.map(loss => ({ objectId: loss.objectId, field: loss.field, reason: loss.reason })) };
}

export function buildExchange(input: { scope: SnapshotScope; frame: { horizontal: string; vertical: string; unit: string };
  records: ExchangeRecord[]; sources: Source[]; licenceFamily: string | null }) {
  input={...input,records:input.records.map(record=>({...record,body:registryDocumentSnapshotView(record.body)}))};
  const losses: Loss[] = [], cityObjects: Json = {};
  const sources = new Map(input.sources.map(source => [source.id, source]));
  // Decide visibility once. A withheld record cannot reappear through the sidecar or LADM report.
  const allowedRecords = input.records.filter(record => {
    const body = record.body.body ?? record.body;
    if (body.synthetic === true || record.sourceIds.length === 0) {
      losses.push({ objectId: record.id, field: 'sourceQualification', category: 'unsupported',
        reason: body.synthetic === true ? 'Historical synthetic record is not an official source'
          : 'No linked original source revision' });
      return false;
    }
    const referenced = record.sourceIds.map(id => sources.get(id));
    if (referenced.some(source => !source)) {
      losses.push({ objectId: record.id, field: 'sources', category: 'unsupported', reason: 'Exact source revision unavailable' });
      return false;
    }
    const families = [...new Set(referenced.map(source => source?.licenceFamily).filter((s): s is string => !!s))];
    if (input.licenceFamily && families.some(family => isShareAlike(family) && family !== input.licenceFamily)) {
      losses.push({ objectId: record.id, field: 'licenceFamily', category: 'withheld', reason: 'Share-alike licence conflicts with export family' });
      return false;
    }
    return true;
  });
  const byId = new Map(allowedRecords.map(record => [record.id, record]));
  const allowedSourceIds = new Set(allowedRecords.flatMap(record => record.sourceIds));
  for (const record of allowedRecords) {
    const body = record.body.body ?? record.body;
    const type = objectType(body.kind);
    if (!type) { losses.push({ objectId: record.id, field: 'kind', category: 'unsupported', reason: 'No P3-CJ/1 CityObject type' }); continue; }
    const linked = (Array.isArray(body.links) ? body.links : []).filter((link: Json) =>
      (link.type === 'within' || link.type === 'floor') && byId.has(link.targetId));
    const parents = linked.filter((link: Json) => {
      const parent = byId.get(link.targetId)!;
      const parentKind = (parent.body.body ?? parent.body).kind;
      return type === 'BuildingStorey' ? parentKind === 'building'
        : type === 'BuildingUnit' && (parentKind === 'floor' || parentKind === 'building');
    });
    if (type !== 'Building' && parents.length !== 1) {
      losses.push({ objectId: record.id, field: 'body.links', category: 'unsupported',
        reason: parents.length ? 'CityJSON core permits one parent; all links remain in sidecar' : 'Selected parent unavailable' });
      continue;
    }
    const referenced = record.sourceIds.map(id => sources.get(id));
    if (referenced.some(source => !source?.metadata.sourceAuthority && !source?.metadata.source_authority))
      losses.push({ objectId: record.id, field: 'sourceAuthority', category: 'unsupported',
        reason: 'Issuing authority is not recorded in this source revision; official-source qualification is unavailable' });
    const families = [...new Set(referenced.map(source => source?.licenceFamily).filter((s): s is string => !!s))];
    if (families.length > 1) losses.push({ objectId: record.id, field: 'licenceFamily', category: 'unsupported',
      reason: 'Multiple source licence families; review compatibility before distribution' });
    if (referenced.some(source => !source?.licenceFamily)) losses.push({ objectId: record.id,
      field: 'licenceFamily', category: 'unsupported', reason: 'Licence family is not recorded for every source' });
    const attrs: Json = { recordId: record.id, recordRevision: record.pin.revision,
      manifestDigest: input.scope.snapshotDigest, projectCode: record.body.projectIdentity?.code ?? null,
      identifierScheme: 'application-project-p3-1', name: body.name ?? null };
    const object: Json = { type, attributes: attrs };
    if (parents.length === 1) object.parents = [parents[0].targetId];
    losses.push({ objectId: record.id, field: 'geometry', category: 'unsupported',
      reason: 'No source-supplied solid with an exact 3D reference is available through this registry profile' });
    cityObjects[record.id] = object;
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, object] of Object.entries(cityObjects)) if (Array.isArray(object.parents)
      && !cityObjects[object.parents[0]]) {
      delete cityObjects[id]; changed = true;
      losses.push({ objectId: id, field: 'parents', category: 'unsupported', reason: 'Parent omitted from this export' });
    }
  }
  for (const [id, object] of Object.entries(cityObjects)) if (Array.isArray(object.parents)) {
    const parent = cityObjects[object.parents[0]];
    parent.children = [...(parent.children ?? []), id].sort();
  }
  const cityJson = { type: 'CityJSON', version: '2.0', transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
    metadata: { referenceSystem: `https://www.opengis.net/def/crs/EPSG/0/${input.frame.horizontal.slice(5)}`,
      verticalReference: input.frame.vertical, identifier: input.scope.manifestId },
    CityObjects: cityObjects, vertices: [] as number[][] };
  const sidecar = { profile: 'P3-CJ/1', manifestId: input.scope.manifestId,
    manifestDigest: input.scope.snapshotDigest, cityJsonSha256: sha256(JSON.stringify(cityJson)),
    cityJsonEncoding: 'JSON.stringify UTF-8',
    access: 'private', codeNamespace: 'P3/1', frame: input.frame,
    exportLicenceFamily: input.licenceFamily,
    requestedPins: input.records.map(record => record.pin),
    omissions:[{field:'documentCitations',category:'omitted_by_profile',
      reason:'Private document citation pins are excluded from this general exchange profile.'}],
    records: allowedRecords.map(record => ({ ...record,
      bodyProjection:{profile:'registry-private-projection/1',sha256:fingerprint(record.body),
        sha256Basis:'canonical_served_body',capturedBodySha256:record.bodySha256,capturedBodyHashBasis:'immutable_captured_body'},
      omittedFromCityJson: !cityObjects[record.id] })),
    sources: input.sources.filter(source => allowedSourceIds.has(source.id)).map(source => ({ ...source })), losses };
  return { cityJson, sidecar, ladm: mapping(allowedRecords, cityObjects, losses), losses };
}

function validateCityJson(value: unknown, frame: { horizontal: string; vertical: string }) : asserts value is Json {
  if (!shape(value) || value.type !== 'CityJSON' || value.version !== '2.0'
    || !shape(value.transform) || canonical(value.transform.scale) !== canonical([1,1,1])
    || canonical(value.transform.translate) !== canonical([0,0,0])
    || !shape(value.CityObjects) || !Array.isArray(value.vertices)
    || value.metadata?.referenceSystem !== `https://www.opengis.net/def/crs/EPSG/0/${frame.horizontal.slice(5)}`
    || value.metadata?.verticalReference !== frame.vertical) {
    throw new AppError(422, 'USP_EXCHANGE_CITYJSON', 'CityJSON 2.0 or its exact reference frame is invalid.');
  }
  if (value.vertices.length > 300000 || value.vertices.some((v: unknown) => !Array.isArray(v) || v.length !== 3
    || v.some(n => !Number.isSafeInteger(n)))) throw new AppError(422, 'USP_EXCHANGE_VERTICES', 'CityJSON vertices are invalid.');
  for (const [id, object] of Object.entries(value.CityObjects)) {
    if (!uuid.safeParse(id).success || !shape(object) || !['Building','BuildingStorey','BuildingUnit'].includes(object.type)
      || object.attributes?.recordId !== id || object.attributes?.recordRevision < 1) {
      throw new AppError(422, 'USP_EXCHANGE_OBJECT', 'A CityJSON object has invalid identity or type.');
    }
    if (Array.isArray(object.geometry)) for (const geometry of object.geometry) {
      if (!shape(geometry) || geometry.type !== 'Solid' || !Array.isArray(geometry.boundaries))
        throw new AppError(422, 'USP_EXCHANGE_GEOMETRY', 'Unsupported CityJSON geometry.');
      const walk = (part: unknown): void => {
        if (Array.isArray(part)) { for (const item of part) walk(item); return; }
        if (!Number.isInteger(part) || (part as number) < 0 || (part as number) >= value.vertices.length)
          throw new AppError(422, 'USP_EXCHANGE_INDEX', 'CityJSON vertex index is invalid.');
      };
      walk(geometry.boundaries);
    }
  }
}

function hierarchyConflicts(cityObjects: Json): Comparison[] {
  const conflicts: Comparison[] = [];
  for (const [id, object] of Object.entries(cityObjects)) {
    const parents = object.parents;
    if (object.type === 'Building') {
      if (parents !== undefined) conflicts.push({ objectId: id, field: 'CityObject.parents', category: 'conflict',
        detail: 'A Building cannot have a parent in this profile' });
    } else if (!Array.isArray(parents) || parents.length !== 1 || typeof parents[0] !== 'string'
      || !cityObjects[parents[0]] || (object.type === 'BuildingStorey' && cityObjects[parents[0]].type !== 'Building')
      || (object.type === 'BuildingUnit' && !['Building','BuildingStorey'].includes(cityObjects[parents[0]].type))) {
      conflicts.push({ objectId: id, field: 'CityObject.parents', category: 'conflict',
        detail: 'The single required parent is absent or has an unsupported type' });
    } else if (!Array.isArray(cityObjects[parents[0]].children)
      || !cityObjects[parents[0]].children.includes(id)) {
      conflicts.push({ objectId: id, field: 'CityObject.parents', category: 'conflict',
        detail: 'The parent does not list this child' });
    }
    if (object.children !== undefined) {
      if (!Array.isArray(object.children) || new Set(object.children).size !== object.children.length
        || object.children.some((childId: unknown) => typeof childId !== 'string'
          || !cityObjects[childId] || !Array.isArray(cityObjects[childId].parents)
          || cityObjects[childId].parents.length !== 1 || cityObjects[childId].parents[0] !== id)) {
        conflicts.push({ objectId: id, field: 'CityObject.children', category: 'conflict',
          detail: 'Children must resolve uniquely and link back to this parent' });
      }
    }
  }
  return conflicts;
}

export function compareExchange(expected: ReturnType<typeof buildExchange>, suppliedCity: unknown,
  suppliedSidecar: unknown) {
  validateCityJson(suppliedCity, expected.sidecar.frame);
  const city = suppliedCity as Json;
  if (suppliedSidecar !== null) {
    const sidecar = suppliedSidecar;
    if (!shape(sidecar) || sidecar.profile !== 'P3-CJ/1' || sidecar.manifestId !== expected.sidecar.manifestId
      || sidecar.manifestDigest !== expected.sidecar.manifestDigest
      || sidecar.cityJsonSha256 !== sha256(JSON.stringify(city)) || sidecar.access !== 'private'
      || sidecar.cityJsonEncoding !== 'JSON.stringify UTF-8'
      || sidecar.codeNamespace !== 'P3/1' || canonical(sidecar.frame) !== canonical(expected.sidecar.frame)
      || sidecar.exportLicenceFamily !== expected.sidecar.exportLicenceFamily
      || canonical(sidecar.requestedPins) !== canonical(expected.sidecar.requestedPins))
      throw new AppError(422, 'USP_EXCHANGE_BINDING', 'The sidecar does not bind to these CityJSON bytes and snapshot.');
    if (!Array.isArray(sidecar.sources) || sidecar.sources.length !== expected.sidecar.sources.length
      || sidecar.sources.some((source: unknown, i: number) => !shape(source)
        || source.id !== expected.sidecar.sources[i].id || source.revision !== expected.sidecar.sources[i].revision
        || source.sha256 !== expected.sidecar.sources[i].sha256 || source.bodySha256 !== expected.sidecar.sources[i].bodySha256
        || canonical(source.metadata) !== canonical(expected.sidecar.sources[i].metadata)))
      throw new AppError(422, 'USP_EXCHANGE_SOURCE', 'An exact source revision or original hash changed.');
    if (!Array.isArray(sidecar.records) || sidecar.records.length !== expected.sidecar.records.length)
      throw new AppError(422, 'USP_EXCHANGE_RECORDS', 'The sidecar record set changed.');
  }
  const sidecar = suppliedSidecar as Json | null;
  const report: Comparison[] = [];
  report.push(...hierarchyConflicts(city.CityObjects));
  if (sidecar && canonical(sidecar.losses) !== canonical(expected.losses))
    report.push({ objectId: null, field: 'sidecar.losses', category: 'conflict' });
  if(sidecar && canonical(sidecar.omissions)!==canonical(expected.sidecar.omissions))
    report.push({objectId:null,field:'sidecar.omissions',category:'conflict'});
  if (canonical(city.metadata) !== canonical(expected.cityJson.metadata))
    report.push({ objectId: null, field: 'CityJSON.metadata', category: 'conflict' });
  for (const id of Object.keys(city.CityObjects)) if (!expected.cityJson.CityObjects[id])
    report.push({ objectId: id, field: 'CityObject', category: 'conflict', detail: 'Unexpected object' });
  for (const record of expected.sidecar.records) {
    // Sidecar facts are checked even when this profile has no CityObject representation.
    const returned = sidecar?.records?.find((entry: Json) => entry?.id === record.id);
    if (sidecar && canonical(returned) !== canonical(record))
      report.push({ objectId: record.id, field: 'sidecar.record', category: 'conflict' });
    for (const key of ['pin', 'bodySha256', 'sourceIds', 'licenceFamily', 'omittedFromCityJson'] as const)
      report.push({ objectId: record.id, field: `sidecar.${key}`, category: !sidecar ? 'omitted_by_profile'
        : canonical(record[key]) === canonical(returned?.[key]) ? 'exact' : 'conflict' });
    for (const [key, value] of Object.entries(record.body)) report.push({ objectId: record.id,
      field: `record.${key}`, category: !sidecar ? 'omitted_by_profile'
        : !returned ? 'conflict' : canonical(value) === canonical(returned.body?.[key]) ? 'exact' : 'conflict' });
    const capturedBody = record.body.body;
    if (shape(capturedBody)) for (const [key, value] of Object.entries(capturedBody))
      report.push({ objectId: record.id, field: `record.body.${key}`, category: !sidecar ? 'omitted_by_profile'
        : !returned ? 'conflict' : canonical(value) === canonical(returned.body?.body?.[key]) ? 'exact' : 'conflict' });
    const object = city.CityObjects[record.id];
    const expectedObject = expected.cityJson.CityObjects[record.id];
    if (!expectedObject) {
      report.push({ objectId: record.id, field: 'CityObject', category: 'unsupported' });
      continue;
    }
    if (!object) { report.push({ objectId: record.id, field: 'CityObject', category: 'conflict' }); continue; }
    for (const key of ['type', 'attributes', 'parents', 'children', 'geometry']) {
      const a = expectedObject[key], b = object[key];
      report.push({ objectId: record.id, field: `CityObject.${key}`,
        category: canonical(a ?? null) === canonical(b ?? null) ? 'exact' : 'conflict' });
    }
  }
  for (const source of expected.sidecar.sources) report.push({ objectId: null,
    field: `source.${source.id}@${source.revision}.sha256`, category: sidecar ? 'exact' : 'omitted_by_profile' });
  for (const loss of expected.losses) report.push({ objectId: loss.objectId, field: loss.field,
    category: loss.category, detail: loss.reason });
  for(const omission of expected.sidecar.omissions)report.push({objectId:null,field:omission.field,
    category:'omitted_by_profile',detail:omission.reason});
  return { profile: 'P3-CJ/1', manifestId: expected.sidecar.manifestId,
    state: report.some(row => row.category === 'conflict') ? 'conflict' : 'compared',
    comparisons: report, mutation: 'none; reviewed commands are required' };
}

async function exactInput(ctx: RequestContext, scope: SnapshotScope, targets: TargetPin[]) {
  const manifest = await readManifest(ctx, scope);
  const keys = targets.map(pin => `${pin.ref.namespace}:${pin.ref.id}@${pin.revision}`);
  if (new Set(keys).size !== keys.length || targets.some(pin => pin.ref.namespace !== 'registry_record'
    || !manifest.members.some(member => canonical(member.pin) === canonical(pin))
    || (manifest.selection?.kind === 'targets' && !manifest.selection.pins.some(selected => canonical(selected) === canonical(pin)))))
    throw new AppError(422, 'USP_EXCHANGE_TARGET', 'Choose distinct captured registry records.');
  const sitePin = manifest.members.find(member => member.pin.ref.namespace === 'registry_site');
  if (!sitePin) throw new AppError(409, 'USP_EXCHANGE_SITE', 'The exact site frame is unavailable.');
  const frame = assertFrame(await readSnapshotBody(ctx, scope, sitePin.pin));
  const records: ExchangeRecord[] = [];
  const sourceIds = new Set<string>();
  for (const pin of targets) {
    const member = manifest.members.find(member => canonical(member.pin) === canonical(pin))!;
    const body = await readSnapshotBody(ctx, scope, pin);
    const sourceIdsForRecord = bindings(body);
    sourceIdsForRecord.forEach(id => sourceIds.add(id));
    records.push({ id: pin.ref.id, pin, bodySha256: member.bodySha256, body,
      sourceIds: sourceIdsForRecord, licenceFamily: null });
  }
  const codes = records.map(record => record.body.projectIdentity?.code).filter((code): code is string => typeof code === 'string');
  if (new Set(codes).size !== codes.length || codes.some(code => normalizeProjectCode(code) !== code))
    throw new AppError(409, 'USP_EXCHANGE_CODE', 'A captured project code is invalid or duplicated.');
  const sources: Source[] = [];
  for (const id of [...sourceIds].sort()) {
    const member = manifest.members.find(member => member.pin.ref.namespace === 'source_revision' && member.pin.ref.id === id);
    if (!member) throw new AppError(409, 'USP_EXCHANGE_SOURCE', 'A referenced exact source revision is unavailable.');
    const {body,bytes} = await readSnapshotOriginal(ctx, scope, member.pin);
    if (body.id !== id || body.revision !== member.pin.revision || typeof body.sha256 !== 'string'
      || typeof body.object_key !== 'string') throw new AppError(409, 'USP_EXCHANGE_SOURCE', 'A source receipt is incomplete.');
    if (!Number.isSafeInteger(Number(body.bytes)) || Number(body.bytes) > 100_000_000)
      throw new AppError(413, 'USP_EXCHANGE_SOURCE_SIZE', 'Select a smaller source scope.');
    if (sha256(bytes) !== body.sha256 || bytes.length !== Number(body.bytes))
      throw new AppError(422, 'USP_EXCHANGE_SOURCE_HASH', 'A retained original no longer matches its source receipt.');
    const { object_key: _privateKey, ...metadata } = body;
    sources.push({ id, revision: body.revision, sha256: body.sha256,
      licenceFamily: sourceLicence(body), bodySha256: member.bodySha256, metadata });
  }
  for (const record of records) {
    const families = [...new Set(record.sourceIds.map(id => sources.find(source => source.id === id)?.licenceFamily).filter(Boolean))];
    record.licenceFamily = families.length === 1 ? families[0]! : null;
  }
  return { frame, records, sources };
}

export async function exportCityJson(ctx: RequestContext, raw: unknown) {
  assertLocalUsp(ctx);
  const input = UspExchangeExportSchema.parse(raw);
  const exact = await exactInput(ctx, input.scope, input.targets);
  const result = buildExchange({ scope: input.scope, ...exact, licenceFamily: input.licenceFamily });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 900_000)
    throw new AppError(413, 'USP_EXCHANGE_SIZE', 'Select a smaller export scope.');
  await readManifest(ctx,input.scope);
  return result;
}

export async function compareCityJson(ctx: RequestContext, raw: unknown) {
  assertLocalUsp(ctx);
  const input = UspExchangeCompareSchema.parse(raw);
  if (!shape(input.cityJson.CityObjects)) throw new AppError(422, 'USP_EXCHANGE_CITYJSON', 'CityObjects are required.');
  const ids = shape(input.sidecar) && Array.isArray(input.sidecar.requestedPins)
    ? input.sidecar.requestedPins.map((pin: unknown) => shape(pin) && shape(pin.ref) ? pin.ref.id : null)
    : Object.keys(input.cityJson.CityObjects);
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length
    || ids.some(id => !uuid.safeParse(id).success))
    throw new AppError(422, 'USP_EXCHANGE_TARGET', 'Choose 1 to 100 exact registry objects.');
  const manifest = await readManifest(ctx, input.scope);
  const pins = ids.map(id => manifest.members.find(member => member.pin.ref.namespace === 'registry_record' && member.pin.ref.id === id)?.pin);
  if (pins.some(pin => !pin)) throw new AppError(409, 'USP_EXCHANGE_TARGET', 'An exact registry object is unavailable.');
  const exact = await exactInput(ctx, input.scope, pins as TargetPin[]);
  const licenceFamily = shape(input.sidecar) && typeof input.sidecar.exportLicenceFamily === 'string'
    ? input.sidecar.exportLicenceFamily : null;
  const expected = buildExchange({ scope: input.scope, ...exact, licenceFamily });
  return compareExchange(expected, input.cityJson, input.sidecar);
}
