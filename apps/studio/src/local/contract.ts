import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

type Json = unknown;

/** OpenAPI 3.0 writes `minimum: n, exclusiveMinimum: true`; JSON Schema puts the bound in `exclusiveMinimum`. */
const EXCLUSIVE_BOUNDS: Record<string, string> = { exclusiveMinimum: 'minimum', exclusiveMaximum: 'maximum' };

function isExclusiveBound(node: Record<string, Json>, key: string): boolean {
  return Object.entries(EXCLUSIVE_BOUNDS).some(([flag, bound]) => bound === key && node[flag] === true);
}

/** OpenAPI 3.0 → JSON Schema: `nullable` becomes a null alternative; refs point into one document. */
function convert(node: Json): Json {
  if (Array.isArray(node)) return node.map(convert);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node as Record<string, Json>)) {
    if (key === 'nullable' || key === 'example' || key.startsWith('x-')) continue;
    if (EXCLUSIVE_BOUNDS[key]) {
      if (value === true) out[key] = (node as Record<string, Json>)[EXCLUSIVE_BOUNDS[key]!];
      continue;
    }
    if (isExclusiveBound(node as Record<string, Json>, key)) continue;
    out[key] = key === '$ref' && typeof value === 'string' ? value.replace('#/', 'openapi#/') : convert(value);
  }
  return (node as { nullable?: boolean }).nullable ? { anyOf: [out, { type: 'null' }] } : out;
}

/** Validators for response schemas in docs/api/openapi.json, so local answers cannot drift from the API. */
export function createContractValidator(openapi: { components: { schemas: Record<string, Json> } }) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'openapi', components: convert(openapi.components) as object });
  const cache = new Map<string, ValidateFunction>();
  return (schemaName: string, value: unknown): string[] => {
    let validate = cache.get(schemaName);
    if (!validate) {
      validate = ajv.compile({ $ref: `openapi#/components/schemas/${schemaName}` });
      cache.set(schemaName, validate);
    }
    return validate(value) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
  };
}
