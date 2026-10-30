/** Lexical privacy controls only; every number here is generated test_only text, not an identifier record. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskJsonNumberTokens, redactDerivative, redactPrivateText,
} from '../packages/server/src/modules/usp/ingest/redact';

const RUN_LENGTH = 64 * 1024;
const LIMIT_MS = 100;

// Copy of maskJsonNumberTokens before a span that fails a boundary check was copied whole.
function previousMaskJsonNumberTokens(text: string): string {
  let result = '', quoted = false, escaped = false;
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      index++;
      continue;
    }
    if (character === '"') { quoted = true; result += character; index++; continue; }
    if (character === '-' || /[0-9]/.test(character)) {
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
      const end = index + (match?.[0].length ?? 0);
      if (match && (index === 0 || /[\s:[,]/.test(text[index - 1]))
        && (end === text.length || /[\s,}\]]/.test(text[end]))) {
        const token = match[0];
        const normalized = Number.isSafeInteger(Number(token)) ? String(Number(token)) : token;
        const masked = redactPrivateText(normalized);
        result += masked === normalized ? token : JSON.stringify(masked);
        index = end;
        continue;
      }
    }
    result += character; index++;
  }
  return result;
}

const handPicked = [
  '[9876543210,12]', '{"a":9876543210}', '[98765432101]', '[9876543210x]', '[x9876543210]', '[-9876543210]',
  '[+9876543210]', '[09876543210]', '[9876543210.5]', '[9876543210e0]', '[1e5e5]', '[1.2.3]', '[--9876543210]',
  '[123456789012, 1234567890123456]', '["9876543210", 9876543210]', '["a\\"", 9876543210]', '["\\\\", 9876543210]',
  '[1-9876543210]', '[1.9876543210]', '[0.9876543210]', '{"k":-0.5e-3,"p":9876543210}', '9876543210',
  '[1234 5678 9012]', '[\n9876543210\t]', '["unclosed 9876543210', '[9876543210',
];

const fragments = [
  '[', ']', '{', '}', ',', ':', ' ', '\n', '\t', '"', '\\', '\\"', '"a"', '"x\\"9876543210"', '"k":', '-', '+', '.',
  'e', 'E', 'e-', 'E+', '0', '00', '1', '7', '12', '007', '12.5', '-0.5e-3', '1e5', '9876543210', '98765 43210',
  '123456789012', '1234567890123456', '-9876543210', 'x', 'abc', 'true', 'null',
];

/** Deterministic test_only strings: the same seed gives the same corpus on every run. */
function generatedCorpus(count: number): string[] {
  let seed = 0x6a51;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: count }, () => {
    const length = 1 + Math.floor(next() * 30);
    return Array.from({ length }, () => fragments[Math.floor(next() * fragments.length)]).join('');
  });
}

function elapsedMs(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

test('long digit runs inside JSON-shaped text are masked in linear time', () => {
  const shapes = {
    digits: `[${'7'.repeat(RUN_LENGTH)}x`,
    minusAndDots: `[${'12-3.4'.repeat(RUN_LENGTH / 4).slice(0, RUN_LENGTH)}x`,
    minusDotsAndExponents: `[${'9-1.5e3-'.repeat(RUN_LENGTH / 8)}x`,
  };
  for (const [shape, text] of Object.entries(shapes)) {
    assert.ok(text.length >= RUN_LENGTH, shape);
    const ms = elapsedMs(() => redactDerivative(text));
    assert.ok(ms < LIMIT_MS, `${shape} took ${ms.toFixed(1)} ms`);
  }
});

test('JSON number masking is unchanged on hand-picked and generated test_only strings', () => {
  const corpus = [...handPicked, ...generatedCorpus(2000)];
  assert.ok(corpus.filter(text => previousMaskJsonNumberTokens(text) !== text).length >= 150);
  for (const text of corpus) {
    assert.equal(maskJsonNumberTokens(text), previousMaskJsonNumberTokens(text), JSON.stringify(text));
  }
  assert.equal(maskJsonNumberTokens('[9876543210,12]'), '["[redacted phone]",12]');
  assert.equal(maskJsonNumberTokens('[9876543210x]'), '[9876543210x]');
  assert.equal(maskJsonNumberTokens('["a\\"", 9876543210]'), '["a\\"", "[redacted phone]"]');
});
