import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import fixtures from '../../../../../../scripts/agent/mapping-teacher.fixtures.json';
import { maskColumnSample, profileColumns } from './column-profile';

const marker = '[…]';
const fixtureHashes = [
  'fc24c4c8ff8164fd02d24ac279e4dbd31438ecaf17642894d76dd8c58b273645',
  '7b39e3e262c187d1f0d58d6a6bf66f1c02524ae86dd83a5a01f897fb5a656b1f',
  '73aed191552229fd873cd90e3a01fbf920ef999c2a53f5c0d9c16a63afcbf1eb',
  '76c4bdd4cf53745c638c5428a63df62448ff16ca164b280de5adfc92a9efc465',
  'afbe4881f62d69ac77beb5189a362a187d14158d99e8705347a75f5387c85761',
  '5fd622d92590939771bc203daf9f57bd27f26a40bcfafe1b6d607240ffc535db',
  '8e460a58112ebe8b8ed2c6e74eda4388b62921ab7ca91d0fc1284edfc49f1499',
  '6fbf2b41b3f94199d841ba858d21a6e2f2483950561d037e94c5d72086b510be',
  '99545ee4a5ffd432d648434c9030ff24d797bc7020e882da710b16cc151960bd',
  'd213315d260563f8e92dc559e13d87e3c529dcb3a01423cd81ca61facadac245',
  '50eee89c5553061ab86df55e63b8988661b956e73dd5dd63cdb25b1618d27854',
  '00c8f7a48b8330cb7f4a3682751d4d8dbad9cb5da0e1234a7652aabc3ffbaac0',
  'f345663db7b98277fe107c751aba82a9d08209d37469829495e8bd6da6df645e',
  'f1acf699ed5876f497c1338548df1e484aecfd1414e10bee9e78ee9ec7a3ca52',
  '3422fe6bb0f56ed2b8f3508b03e6c2b890176fe266f38e9683977ff4b8d542c7',
  'f1acf699ed5876f497c1338548df1e484aecfd1414e10bee9e78ee9ec7a3ca52',
  'f1acf699ed5876f497c1338548df1e484aecfd1414e10bee9e78ee9ec7a3ca52',
  '736c8141df5a83d253e530858db9fa4a11f0bb939db12ab22b922e95291350de',
  'f1acf699ed5876f497c1338548df1e484aecfd1414e10bee9e78ee9ec7a3ca52',
  'f345663db7b98277fe107c751aba82a9d08209d37469829495e8bd6da6df645e',
  'c50db343d48970c8bdc2def3f4da03e8fb8f8f7c2bf8cc18738a216db51cf800',
  'f345663db7b98277fe107c751aba82a9d08209d37469829495e8bd6da6df645e',
  'f345663db7b98277fe107c751aba82a9d08209d37469829495e8bd6da6df645e',
  'c6fd8c4a63e46557853d168ed1c28c4bbcb2cabb40b56b5ad1f7d36f68cadf52',
  '4c62be86489847ecc147134c3b092f451c8264076f1ed1a9990429eac3bf6d82',
  'd042af9ef7da455a76497cfdfa02ee406b4938af03775a22450bc732af6da2f6',
  '96281876ce53ba08331dbc738acaf8f01f64d0f2dcaa1d9652209238ba60a27d',
  'cf038683f04281b15fc0477b8cf9332bf81d29f75983dbf0fbac28fe2a24b7cf',
  'afbe4881f62d69ac77beb5189a362a187d14158d99e8705347a75f5387c85761',
  'da810c5f9d08e2231b417160ddffec4148085e6f45e49bd001ceed40de648975',
];

test('an expanding cell stays within 256 characters and ends in the shortening marker', () => {
  const raw = [...Array(10).fill('123412341234'), 'a@b.co'].join(',');
  const sample = maskColumnSample(raw);
  assert(sample.length <= 256);
  assert(sample.endsWith(marker));
  assert(!/[0-9]/u.test(sample));
  const profile = profileColumns([{ cell: raw }], [{ name: 'cell' }], 'tabular');
  assert.equal(profile.columns[0].maskedSamples[0], sample);
});

test('boundary digit and letter runs never leave a partial masked token', () => {
  const runs = ['123412341234', '६१२३४५६७८९', '6123456789', 'ABCDE1234F', 'a@b.co'];
  for (const header of ['', 'owner']) {
    const tokens = runs.map(run => maskColumnSample(run, header)).concat(marker);
    for (let length = 210; length <= 265; length++) {
      for (const run of [...runs, ...Array.from({ length: 16 }, (_, index) => '6'.repeat(index + 1))]) {
        const sample = maskColumnSample(`${'a'.repeat(length)},${run},${run}`, header);
        assert(sample.length <= 256);
        let remainder = sample;
        for (const token of tokens) remainder = remainder.split(token).join('');
        assert(!/[\[\]0-9१-९]/u.test(remainder), `partial token at ${header}/${length}/${run.length}`);
      }
    }
  }
});

test('a cell masking to exactly 256 characters is unchanged and unmarked', () => {
  const raw = `${'x'.repeat(231)},123412341234`;
  const expected = `${'x'.repeat(231)},[Aadhaar:DDDD DDDD DDDD]`;
  assert.equal(expected.length, 256);
  assert.equal(maskColumnSample(raw), expected);
  assert(!maskColumnSample(raw).endsWith(marker));
  // A pattern crossing the historical raw prefix still cannot expose a digit fragment.
  assert.equal(maskColumnSample(`${'a'.repeat(255)}6123456789`), `${'x'.repeat(255)}D`);
});

test('every existing profile fixture sample keeps its pre-fix SHA-256', () => {
  const hashes = fixtures.profileRows.flatMap(row => Object.entries(row).map(([header, value]) =>
    createHash('sha256').update(JSON.stringify(maskColumnSample(value, header))).digest('hex')));
  assert.deepEqual(hashes, fixtureHashes);
});
