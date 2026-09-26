import { AppError } from '../../infrastructure/errors';
import { redactDerivative, redactPrivateText } from '../usp/ingest/redact';

const credentialKey = /^(apikey|secret|password|authorization|credential|accesstoken|subscriptionkey)$/i;
const unavailable = (value: unknown) => value === null || typeof value === 'string' && /^(unknown|absent|withheld|conflicting)$/i.test(value);
const probe = 'model-redaction-key-classification';
const privacyFailure = (): never => { throw new AppError(403,'MODEL_PROMPT_PRIVACY','Structured model text could not be safely minimized.'); };
type Budget = { remaining: number };
const spend = (budget: Budget, amount: number) => { if ((budget.remaining -= amount) < 0) privacyFailure(); };
const checkDepth = (depth: number) => { if (depth > 40) privacyFailure(); };
function privateField(key: string): boolean {
  // Reuse the shared personal-field policy without parsing source numbers into JS floats.
  const classified = redactDerivative({[key]:probe});
  return Object.values(classified)[0] !== probe;
}
const secretText = (value: string, secret?: string) => secret ? value.split(secret).join('[redacted provider secret]') : value;

/** A derivative-only JSON token pass. Numbers and unchanged string lexemes are copied verbatim.
 * Nested JSON encoded as string values uses the same policy. An ambiguous/truncated structure
 * or work/depth overflow never falls back to forwarding the unprocessed text.
 */
function text(value: string, budget: Budget, depth: number, secret?: string): string {
  checkDepth(depth); spend(budget,value.length);
  const first = value.trimStart()[0];
  const marker = /^\s*\[redacted(?: [^\]\r\n]{0,80})?\]/.test(value);
  const structured = !marker && (first === '{' || first === '[' || first === '"' && value.trimEnd().endsWith('"'));
  if (!structured) {
    // Mixed/truncated structured snippets have no safe token context. A recognized encoded
    // credential field cannot fall through as ordinary prose; retain the original locally.
    for (const match of value.matchAll(/"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"\s*:/g)) {
      const key=JSON.parse(match[0].slice(0,match[0].lastIndexOf(':')).trim()) as string;
      if (credentialKey.test(key.replace(/[_ .-]/g,''))) privacyFailure();
    }
    return secretText(redactPrivateText(value),secret);
  }
  let cursor = 0;
  const white = () => { const start=cursor; while (cursor < value.length && /[ \t\r\n]/.test(value[cursor])) cursor++; return value.slice(start,cursor); };
  const string = () => {
    const start=cursor;
    if (value[cursor++] !== '"') privacyFailure();
    let escaped=false;
    while (cursor < value.length) {
      const character=value[cursor++];
      if (!escaped && character === '"') {
        const raw=value.slice(start,cursor);
        try { return {raw,decoded:JSON.parse(raw) as string}; } catch { privacyFailure(); }
      }
      if (!escaped && character === '\\') escaped=true;
      else escaped=false;
    }
    return privacyFailure();
  };
  const parse = (level: number): string => {
    checkDepth(level); spend(budget,1);
    const character=value[cursor];
    if (character === '"') {
      const token=string(), masked=text(token.decoded,budget,level+1,secret);
      return masked === token.decoded ? token.raw : JSON.stringify(masked);
    }
    if (character === '{') {
      cursor++; let result='{'+white();
      if (value[cursor] === '}') {cursor++; return result+'}';}
      for (;;) {
        const key=string(), maskedKey=secretText(redactPrivateText(key.decoded),secret);
        result+=(maskedKey === key.decoded ? key.raw : JSON.stringify(maskedKey))+white();
        if (value[cursor++] !== ':') privacyFailure();
        result+=':'+white();
        const start=cursor, original=parse(level+1);
        const rawValue=value.slice(start,cursor);
        if (credentialKey.test(key.decoded.replace(/[_ .-]/g,''))) result+='"[redacted credential field]"';
        else if (privateField(key.decoded)) {
          // Status/null distinctions survive. Personal values use the canonical shared mask.
          let supplied: unknown=rawValue;
          if (rawValue === 'null') supplied=null;
          else if (rawValue[0] === '"') { try { supplied=JSON.parse(rawValue); } catch { privacyFailure(); } }
          const masked=unavailable(supplied) ? supplied : Object.values(redactDerivative({[key.decoded]:supplied}))[0];
          result+=JSON.stringify(masked);
        } else result+=original;
        result+=white();
        if (value[cursor] === '}') {cursor++; return result+'}';}
        if (value[cursor++] !== ',') privacyFailure();
        result+=','+white();
      }
    }
    if (character === '[') {
      cursor++; let result='['+white();
      if (value[cursor] === ']') {cursor++; return result+']';}
      for (;;) {
        result+=parse(level+1)+white();
        if (value[cursor] === ']') {cursor++; return result+']';}
        if (value[cursor++] !== ',') privacyFailure();
        result+=','+white();
      }
    }
    const number=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(value.slice(cursor));
    if (number) {
      cursor+=number[0].length;
      // Number conversion is used only to recognize existing personal-number masking.
      // All nonpersonal numeric tokens, including large integers/decimals, remain exact.
      const normalized=Number.isSafeInteger(Number(number[0])) ? String(Number(number[0])) : number[0];
      const masked=redactPrivateText(normalized);
      return masked === normalized ? number[0] : JSON.stringify(masked);
    }
    const literal=/^(?:true|false|null)/.exec(value.slice(cursor));
    if (!literal) return privacyFailure();
    cursor+=literal[0].length; return literal[0];
  };
  const leading=white(), result=parse(depth)+white();
  if (cursor !== value.length) privacyFailure();
  return leading+result;
}

export function minimizeStructuredText(value: string, secret?: string): string {
  return text(value,{remaining:2*1024*1024},0,secret);
}

/** Parse first, then mask decoded leaves/keys, including further encoded JSON string layers.
 * Native numeric values are returned unchanged; originals and hash receipts are not modified.
 */
export function minimizeDecodedOutput(value: unknown, secret: string): unknown {
  const budget={remaining:2*1024*1024};
  const visit = (input: unknown, depth: number): unknown => {
    checkDepth(depth); spend(budget,1);
    if (typeof input === 'string') return text(input,budget,depth,secret);
    if (Array.isArray(input)) return input.map(item=>visit(item,depth+1));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key,item])=>{
      spend(budget,key.length);
      const maskedKey=secretText(redactPrivateText(key),secret);
      if (credentialKey.test(key.replace(/[_ .-]/g,''))) return [maskedKey,'[redacted credential field]'];
      if (privateField(key)) return [maskedKey,visit(Object.values(redactDerivative({[key]:item}))[0],depth+1)];
      return [maskedKey,visit(item,depth+1)];
    }));
    return input;
  };
  return visit(value,0);
}
