import type { DeclarationInput, DeclarationAssessment, TargetPin } from '@ulpin/contracts/usp';
import { UspDeclarationAssessmentSchema, UspShareFractionSchema } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';

type Rational = { numerator: bigint; denominator: bigint };
const bounded = (n: bigint) => {
  if (n.toString().length > 4096) throw new AppError(413, 'DECLARATION_ARITHMETIC_LIMIT', 'The exact rational sum exceeds this profile.');
  return n;
};
const gcd = (a: bigint, b: bigint): bigint => { while (b) [a, b] = [b, a % b]; return a; };
const normalize = (n: bigint, d: bigint): Rational => { const g = gcd(n, d); return { numerator: bounded(n / g), denominator: bounded(d / g) }; };
export function fraction(value: { numerator: string; denominator: string }): Rational {
  const parsed = UspShareFractionSchema.parse(value);
  return normalize(BigInt(parsed.numerator), BigInt(parsed.denominator));
}
export function add(a: Rational, b: Rational): Rational {
  const g = gcd(a.denominator, b.denominator);
  return normalize(bounded(a.numerator * (b.denominator / g) + b.numerator * (a.denominator / g)),
    bounded((a.denominator / g) * b.denominator));
}
export const rationalWire = (v: Rational) => ({ numerator: v.numerator.toString(), denominator: v.denominator.toString() });
/** Decimal parsing retains the stated unit and never performs an inferred unit conversion. */
export function parseLiteralRational(literal: string) {
  if (literal.length > 256) throw new AppError(422, 'DECLARATION_LITERAL', 'The supplied decimal literal is unsupported.');
  const match = /^(0|[1-9][0-9]{0,63})(?:\.([0-9]{1,64}))?(%| [A-Za-z][A-Za-z0-9 /².-]{0,63})?$/.exec(literal);
  if (!match) throw new AppError(422, 'DECLARATION_LITERAL', 'The supplied decimal literal is unsupported.');
  const n = BigInt(match[1] + (match[2] ?? ''));
  if (n <= 0n) throw new AppError(422, 'DECLARATION_LITERAL', 'A supplied share or quantity must be positive.');
  const d = 10n ** BigInt((match[2] ?? '').length) * (match[3] === '%' ? 100n : 1n);
  return { ...rationalWire(normalize(n, d)), unit: match[3]?.trim() ?? null };
}
export const targetKey = (p: TargetPin) => `${p.ref.namespace}:${p.ref.id}@${p.revision}`;
export function assessDeclaration(input: DeclarationInput): DeclarationAssessment {
  const populations = new Map<string, number>(), entries = new Map<string, number>(), labels = new Map<string, number>();
  for (const p of input.population.targets) populations.set(targetKey(p), (populations.get(targetKey(p)) ?? 0) + 1);
  for (const e of input.entries) {
    entries.set(targetKey(e.target), (entries.get(targetKey(e.target)) ?? 0) + 1);
    labels.set(e.literalLabel, (labels.get(e.literalLabel) ?? 0) + 1);
  }
  const ambiguous = new Set<string>();
  for (const [key, count] of populations) if (count > 1) ambiguous.add(key);
  for (const e of input.entries) if ((entries.get(targetKey(e.target)) ?? 0) > 1 || labels.get(e.literalLabel)! > 1
    || !populations.has(targetKey(e.target))) ambiguous.add(targetKey(e.target));
  const missing = [...populations.keys()].filter(key => !entries.has(key)).length;
  let subtotal: Rational = { numerator: 0n, denominator: 1n };
  for (const e of input.entries) if (!ambiguous.has(targetKey(e.target))) subtotal = add(subtotal, fraction(e.fraction));
  const reasons: string[] = [];
  if (ambiguous.size) reasons.push('ambiguous_members');
  if (missing) reasons.push('missing_members');
  const countMismatch = input.population.declaredCount !== null && input.population.declaredCount !== populations.size;
  if (countMismatch) reasons.push('declared_count_mismatch');
  let state: DeclarationAssessment['state'];
  if (ambiguous.size || input.population.status === 'conflicting') state = 'conflicting_population';
  else if (input.population.status !== 'complete' || missing || countMismatch || input.population.declaredCount === null)
    state = 'not_assessed_incomplete_population';
  else if (input.denominator.state !== 'known') state = 'not_assessed_denominator';
  else state = subtotal.numerator === subtotal.denominator ? 'reconciled' : 'arithmetic_mismatch';
  return UspDeclarationAssessmentSchema.parse({ state, populationStatus: input.population.status,
    knownSubtotal: rationalWire(subtotal), declaredCount: input.population.declaredCount,
    suppliedCount: input.entries.length, missingCount: missing, ambiguousCount: ambiguous.size, reasonCodes: reasons });
}
