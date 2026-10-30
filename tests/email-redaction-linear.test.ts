/** Lexical privacy controls only; every address here is generated test_only text, not a contact record. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { passesVerhoeff, redactPrivateText } from '../packages/server/src/modules/usp/ingest/redact';

const TOKEN_LENGTH = 64 * 1024;
const LIMIT_MS = 100;

// Copy of redactPrivateText and its helpers before the email masking was anchored at run starts.
const personalKey = new RegExp('^(?:(?:owner|father|mother|spouse|applicant|seller|buyer|witness|contact|full)' +
  '(?:s)?name|name|address|residentialaddress|dateofbirth|dob|signature|email|emailaddress|mobile|mobilenumber|' +
  'phone|phonenumber|pan|pannumber|vid|virtualid|virtualidentifier)$', 'i');
const keyName = (key: string) => key.replace(/[\s_'’.-]/g, '');
function spansAdjacentDecimals(value:string,offset:number,input:string):boolean{
  const end=offset+value.length;
  if(!/^\d+\s+\d+$/.test(value)||input[offset-1]!=='.'||!/[0-9]/.test(input[offset-2]??'')||
    input[end]!=='.'||!/[0-9]/.test(input[end+1]??''))return false;
  let start=offset-2,finish=end+1;
  while(start>=0&&/[0-9]/.test(input[start]))start--;
  if(input[start]==='-'||input[start]==='+')start--;
  while(finish<input.length&&/[0-9]/.test(input[finish]))finish++;
  return (start<0||!/[\w.+-]/.test(input[start]))&&(finish===input.length||!/[\w.]/.test(input[finish]));
}
function previousRedactPrivateText(text: string): string {
  const masked = text
    .replace(/(?<![\w])\d{4}(?:[\s-]?\d{4}){3}(?![\w])/g,
      (value,offset,input)=>spansAdjacentDecimals(value,offset,input)?value:'[redacted VID]')
    .replace(/(?<![\w])\d{4}(?:[\s-]?\d{4}){2}(?![\w])/g, (value,offset,input) => {
      if(spansAdjacentDecimals(value,offset,input))return value;
      const digits = value.replace(/\D/g, '');
      return passesVerhoeff(digits) ? `[redacted Aadhaar] XXXX XXXX ${digits.slice(-4)}` : '[redacted identifier]';
    })
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[redacted PAN]')
    .replace(/(?<![\w])(?:\+91[\s-]?|91[\s-]|0)?[6-9](?:[\s-]?\d){9}(?![\w])/g,
      (value,offset,input)=>spansAdjacentDecimals(value,offset,input)?value:'[redacted phone]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/[A-Z0-9._%+-]+\s*(?:\[at\]|\(at\))\s*[A-Z0-9.-]+(?:\s*(?:\[dot\]|\(dot\)|\.)\s*[A-Z0-9-]+)+/gi,
      '[redacted email]');
  return masked.replace(/(^|[\n;|])([^\n;|:=]{1,60})\s*[:=]([^\n;|]*)/g, (line, lead, key, value) => {
    if (personalKey.test(keyName(key.trim()))) return `${lead}${key}: [redacted personal field]`;
    if (/^aadh?aa?r(?:number|no)?$/i.test(keyName(key.trim()))) {
      const lastFour = value.match(/\[redacted Aadhaar\] XXXX XXXX \d{4}/)?.[0];
      return `${lead}${key}: ${lastFour ?? '[redacted personal field]'}`;
    }
    return line;
  });
}

const handPicked = [
  'contact@test.invalid', 'Write to contact@test.invalid.', 'xcontact@test.invalid', 'mailcontact@test.invalidx',
  '(first.last+tag@sub.test.invalid)', ',a_b%c@test-1.invalid;', '-lead@test.invalid', '<x@y.zz>',
  'a@b.co-x@y.org', 'a@b.cc1x@d.ee', 'one@test.invalid,two@test.invalid', 'a@b@c.dd', 'a@b.c', 'a@.dd',
  '@test.invalid',
  'contact [at] test [dot] invalid', 'contact(at)test(dot)invalid', 'first.last [at] test.invalid',
  'x [at] y [dot] com_z [at] w [dot] org', 'x [at] y', 'Email: contact@test.invalid', 'a+b.c@test.invalid end',
  'start 9876543210@test.invalid', 'ABCDE1234Z@test.invalid', '1234 5678 9012@test.invalid',
];

const fragments = [
  'a', 'Zq', 'x9', '0', '7', '.', '_', '%', '+', '-', '@', '@', ' ', '  ', '\t', '\n', ',', ';', ':', '=', '|',
  '(', ')', '<', '>', '!', '[at]', '(at)', ' [at] ', '[dot]', '(dot)', ' [dot] ', '.invalid', 'test', 'example',
  'contact', 'Email', 'Phone: ', '98765', '43210', 'ABCDE', '1234Z', 'é', '.co', '@test.invalid', '@x.co',
  ' [at] y [dot] in', '(at)y(dot)in',
];

/** Deterministic test_only strings: the same seed gives the same corpus on every run. */
function generatedCorpus(count: number): string[] {
  let seed = 0x5ec9;
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

test('long unbroken local-part tokens are masked in linear time', () => {
  const token = 'aB3._%+-'.repeat(TOKEN_LENGTH / 8);
  const shapes = {
    noAt: token,
    spacesNearEnd: `${token.slice(0, -16)}  \t ${token.slice(-12)}`,
    atFormNearEnd: `${token.slice(0, -16)} [at] ${token.slice(-10)}`,
    atSignNearEnd: `${token.slice(0, -16)}@${token.slice(-15)}`,
  };
  for (const [shape, text] of Object.entries(shapes)) {
    assert.ok(text.length >= TOKEN_LENGTH, shape);
    const ms = elapsedMs(() => redactPrivateText(text));
    assert.ok(ms < LIMIT_MS, `${shape} took ${ms.toFixed(1)} ms`);
  }
});

test('email masking is unchanged on hand-picked and generated test_only strings', () => {
  const corpus = [...handPicked, ...generatedCorpus(2000)];
  assert.ok(corpus.filter(text => previousRedactPrivateText(text).includes('[redacted email]')).length >= 200);
  for (const text of corpus) {
    assert.equal(redactPrivateText(text), previousRedactPrivateText(text), JSON.stringify(text));
  }
  assert.equal(redactPrivateText('a@b.co-x@y.org'), '[redacted email][redacted email]');
  assert.equal(redactPrivateText('x [at] y [dot] com_z [at] w [dot] org'), '[redacted email][redacted email]');
  assert.equal(redactPrivateText('(first.last+tag@sub.test.invalid)'), '([redacted email])');
});
