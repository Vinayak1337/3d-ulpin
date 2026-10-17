import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DocumentProposalInputSchema } from '../../../../../contracts/src/usp/document-proposals';
import { checkDocumentProposalQuote, quoteRegionText, type QuotePage } from './document-proposal-quotes';

const tablePath = 'docs/evidence/gf-ai/documents/d2/quote-cases.json';
const table = JSON.parse(readFileSync(tablePath, 'utf8'));
const frame = { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 100, height: 100 } as const;
const page: QuotePage = {
  page: 1, frame, lines: table.lines, basis: { kind: 'ocr_observations', productSha256: null },
};

function proposalFor(item: typeof table.cases[number]) {
  return DocumentProposalInputSchema.parse({
    proposalId: item.name, fieldRole: 'floorExpression', quote: item.quote, lineQuote: null,
    valueLiteral: item.valueLiteral, quoteCharacterSpan: null, status: 'needs_input', reasons: ['control'],
    locator: { page: 1, frame, box: item.box, selectedRegion: null, declaredPrecision: null },
    declaredMethod: 'recorded_software_control', declaredObservation: null,
  });
}

test('TypeScript and Python verify the same shared quotes, regions, normalisation and number groups', () => {
  process.env.ULPIN_PROFILE_PYTHON ??= 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe';
  const code = [
    'import json, sys',
    'sys.path.insert(0, "scripts/usp/learning")',
    'from storey_quote_verifier import verify_item',
    't = json.load(open(sys.argv[1], encoding="utf-8"))',
    's = {"source": {"sha256": t["sourceSha256"]}, "pages": {"1": {"lines": t["lines"]}}}',
    'items = [{**c, "sourceSha256": t["sourceSha256"], "locator": {"page": 1, "bbox": c["box"]}}',
    '         for c in t["cases"]]',
    'print(json.dumps([verify_item(s, i) for i in items]))',
  ].join('\n');
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON, ['-B', '-c', code, tablePath], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr);
  const pythonCodes = JSON.parse(run.stdout);
  for (const [index, item] of table.cases.entries()) {
    const proposal = proposalFor(item);
    const check = checkDocumentProposalQuote(quoteRegionText(page, proposal.locator), proposal);
    assert.deepEqual(check, { outcome: item.outcome, reason: item.reason }, item.name);
    assert.deepEqual(pythonCodes[index], item.pythonCodes, item.name);
    if (item.quote) {
      assert.equal(check.outcome === 'quote_at_locator', pythonCodes[index].length === 0, item.name);
    } else {
      // D2 explicitly requires no_quote to remain not_checked; the offline filter drops missing quotes.
      assert.equal(check.reason, 'no_quote');
    }
  }
});

test('no stored page text or no spatial native text yields not_checked, not a page-wide match', () => {
  const proposal = proposalFor(table.cases[3]);
  assert.equal(quoteRegionText(undefined, proposal.locator), null);
  const native: QuotePage = { ...page, frame: null, lines: [{ text: '81 units', box: null }] };
  const text = quoteRegionText(native, proposal.locator);
  assert.equal(text, null);
  assert.deepEqual(checkDocumentProposalQuote(text, proposal), { outcome: 'not_checked', reason: 'no_region_text' });
  const cropped: QuotePage = { ...page, storedRegion: [10, 60, 90, 70] };
  assert.equal(quoteRegionText(cropped, proposal.locator), null, 'Outside a stored OCR crop is not absent text.');
});

test('a cited box is read within the OCR result\'s own stated edge; TypeScript and Python agree', () => {
  // Numbers of the retained site plan OCR result (K9d): its region, its render scale, one of its boxes.
  const region: [number, number, number, number] = [280, 860, 960, 2580];
  const stated = { renderScalePxPerPt: 0.813953488372093 };
  const overhanging: [number, number, number, number] = [278.8857142857143, 1117.2131, 293.63041428571427, 1174.5536];
  const lines = [{ text: 'a', box: overhanging }];
  const cases = [
    { name: 'equal to an overhanging OCR box of a result that states its edge', regionEdge: stated,
      box: overhanging, text: 'a' },
    { name: 'the same box against a result without the block', regionEdge: undefined, box: overhanging, text: null },
    { name: 'a box further out than one rendered pixel', regionEdge: stated,
      box: [278.7, overhanging[1], overhanging[2], overhanging[3]], text: null },
  ];
  const code = [
    'import json, sys',
    'sys.path.insert(0, "scripts/usp/learning")',
    'from storey_quote_verifier import region_text',
    'answers = []',
    'for case in json.loads(sys.argv[1]):',
    '    page = {"lines": case["lines"], "storedRegion": case["region"]}',
    '    if case.get("regionEdge"): page["regionEdge"] = case["regionEdge"]',
    '    answers.append(region_text({"pages": {"1": page}}, 1, case["box"]))',
    'print(json.dumps(answers))',
  ].join('\n');
  const sent = JSON.stringify(cases.map((item) => ({ ...item, lines, region })));
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe',
    ['-B', '-c', code, sent], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const python = JSON.parse(run.stdout);
  const siteFrame = { ...frame, width: 2585, height: 3390 };
  for (const [index, item] of cases.entries()) {
    const stored: QuotePage = { ...page, frame: siteFrame, lines, storedRegion: region, regionEdge: item.regionEdge };
    const locator = { page: 1, frame: siteFrame, box: item.box, selectedRegion: null, declaredPrecision: null };
    const text = quoteRegionText(stored, locator as Parameters<typeof quoteRegionText>[1]);
    assert.equal(text, item.text, item.name);
    assert.equal(python[index], text, `Python differs: ${item.name}`);
  }
});
