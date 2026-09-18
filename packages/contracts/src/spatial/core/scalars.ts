import { z } from "zod";

export const SPATIAL_CORE_SCHEMA = "ulpin-spatial/2" as const;
export const CORE_SAFE_INTEGER = 9_007_199_254_740_991;
export const CoreIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}(?![\s\S])/);
export const CoreOperationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/);
export const CoreNamespaceSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}(?![\s\S])/);
export const CoreRevisionSchema = z.number().int().min(0).max(CORE_SAFE_INTEGER);
export const CoreSafeIntegerSchema = CoreRevisionSchema;
export const CorePositiveRevisionSchema = z.number().int().min(1).max(CORE_SAFE_INTEGER);
export const CoreFiniteSchema = z.number();
export const CoreSha256Schema = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);

/** Qualified Unicode code-point bound; no coercion, trim or invisible ID rewriting. */
export function coreText(maximum = 512) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4096) throw new Error("Invalid core text bound");
  return z.string().regex(new RegExp(`^[^\\u0000-\\u001f\\u007f]{1,${maximum}}(?![\\s\\S])`, "u"));
}
export const CoreRefSchema = z.strictObject({ namespace: CoreNamespaceSchema, id: CoreIdSchema }).readonly();
export const CoreRevisionRefSchema = z.strictObject({ ref: CoreRefSchema, revision: CoreRevisionSchema }).readonly();
/** Absence, withholding and disagreement are never coerced to a numeric zero. */
export function coreValueSchema<S extends z.ZodType>(value: S) {
  return z.discriminatedUnion("state", [
    z.strictObject({state:z.literal("known"),value}).readonly(),
    z.strictObject({state:z.literal("unknown"),reason:coreText(1024)}).readonly(),
    z.strictObject({state:z.literal("not_applicable"),reason:coreText(1024)}).readonly(),
    z.strictObject({state:z.literal("withheld"),reason:coreText(1024)}).readonly(),
    z.strictObject({state:z.literal("conflicting"),candidates:z.array(CoreRevisionRefSchema).min(2).max(64).readonly(),reason:coreText(1024)}).readonly(),
  ]);
}
export const CoreNumberValueSchema = coreValueSchema(CoreFiniteSchema);
export type CoreRef = z.infer<typeof CoreRefSchema>;
export type CoreRevisionRef = z.infer<typeof CoreRevisionRefSchema>;

export class CoreContractError extends Error {
  readonly code: string;
  readonly path: readonly (string | number)[];
  constructor(code: string, message: string, path: readonly (string | number)[] = []) {
    super(message); this.name = "CoreContractError"; this.code = code; this.path = Object.freeze([...path]);
  }
}
export function coreFail(code: string, message: string, path: readonly (string | number)[] = []): never {
  throw new CoreContractError(code, message, path);
}

/** Bound untrusted in-memory JSON before recursive schema libraries inspect it. */
export function assertCoreJson(input: unknown): void {
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [{ value: input, depth: 0 }];
  const active = new WeakSet<object>(); let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!, value = item.value;
    if (item.leave) { active.delete(value as object); continue; }
    if (++nodes > 1_000_000 || item.depth > 64) coreFail("JSON_LIMIT", "Core input exceeds the node/depth profile");
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") { if (value.length > 1_048_576) coreFail("JSON_LIMIT", "Core string exceeds the input profile"); continue; }
    if (typeof value === "number") { if (!Number.isFinite(value)) coreFail("NON_FINITE", "Core numbers must be finite"); continue; }
    if (typeof value !== "object") coreFail("NON_JSON", "Core input must contain JSON data only");
    if (active.has(value)) coreFail("JSON_CYCLE", "Circular input is not JSON");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array && prototype !== Array.prototype) coreFail("NON_JSON", "Core arrays must use the plain JSON array prototype");
    if (!array && prototype !== Object.prototype && prototype !== null) coreFail("NON_JSON", "Core objects must be plain JSON records");
    const keys = Reflect.ownKeys(value);
    if (keys.length + nodes > 1_000_000) coreFail("JSON_LIMIT", "Core object exceeds the node profile");
    if (keys.some(key => typeof key !== "string")) coreFail("NON_JSON", "Symbol keys are not JSON");
    if (array && (value.length > 1_000_000 || keys.length !== value.length + 1)) coreFail("NON_JSON", "Sparse or extended arrays are not supported");
    active.add(value); pending.push({ value, depth: item.depth, leave: true });
    for (const key of keys) {
      if (array && key === "length") continue;
      if (["__proto__", "prototype", "constructor"].includes(String(key))) coreFail("UNSAFE_KEY", "Reserved object keys are not permitted in core data");
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in property) || !property.enumerable) coreFail("NON_JSON", "Accessors and hidden fields are not JSON data");
      pending.push({ value: property.value, depth: item.depth + 1 });
    }
  }
}
export function parseCore<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  assertCoreJson(input);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    coreFail("INVALID_CONTRACT", "Value does not satisfy the qualified core contract", issue.path.filter((key): key is string | number => typeof key === "string" || typeof key === "number"));
  }
  return parsed.data;
}

/** Stable application/render key; the original namespace and ID remain separate. */
export function coreRefKey(ref: CoreRef): string { return `${ref.namespace}:${encodeURIComponent(ref.id)}`; }
export function sameCoreRef(a: CoreRef, b: CoreRef): boolean { return a.namespace === b.namespace && a.id === b.id; }
export function nextCoreRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === CORE_SAFE_INTEGER) coreFail("REVISION_OVERFLOW", "Cannot advance this revision safely");
  return revision + 1;
}
