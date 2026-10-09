"""Read-only source/metadata checks. Never prints heldout fields, values or URLs.
Run from the repository root. Not an application import or model evaluation.
"""
import csv
import hashlib
import io
import json
import re
import subprocess
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[6]
PACK = ROOT / 'fixtures/usp/D8-messy-india'
HERE = Path(__file__).resolve().parent
BASE = '1d4d9f31'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def load(path):
    return json.loads(Path(path).read_bytes())

def baseline(path):
    return json.loads(subprocess.check_output(['git', 'show', BASE + ':' + path], cwd=ROOT))

def pinned(pin, label):
    data = Path(pin['externalPath']).read_bytes()
    require(len(data) == pin['bytes'] and sha(data) == pin['sha256'], label + ': original pin mismatch')
    return data

def xlsx(data):
    """Extract original sparse cell literals with only the standard library."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        require(z.testzip() is None, 'Workbook ZIP integrity failed')
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        rels = {n.attrib['Id']: n.attrib['Target'] for n in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        result = []
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = rels[rid]
            target = target.lstrip('/') if target.startswith('/') else str(PurePosixPath('xl') / target)
            cells = {}
            for c in ET.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c', NS):
                typ = c.attrib.get('t')
                v = c.find('s:v', NS)
                if typ == 'inlineStr':
                    val = ''.join(n.text or '' for n in c.findall('s:is//s:t', NS))
                elif v is None:
                    continue
                elif typ == 's':
                    val = strings[int(v.text)]
                else:
                    val = v.text or ''
                    if typ in (None, 'n') and val and not re.fullmatch(r'-?\d+', val):
                        val = str(float(val))
                cells[c.attrib['r']] = val
            result.append(cells)
        return result

m = load(PACK / 'manifest.json')
h = load(PACK / 'heldout.json')
counts = load(HERE / 'counts.json')
ledger = load(HERE / 'acquisitions.json')
oldm = baseline('fixtures/usp/D8-messy-india/manifest.json')
oldh = baseline('fixtures/usp/D8-messy-india/heldout.json')
require(m['assets'][:len(oldm['assets'])] == oldm['assets'], 'Historical development assets changed')
require(m['families'][:len(oldm['families'])] == oldm['families'], 'Historical development families changed')
require(h['assets'][:len(oldh['assets'])] == oldh['assets'], 'Historical closed assets changed')
require(h['families'][:len(oldh['families'])] == oldh['families'], 'Historical closed families changed')
require(sha((PACK / 'heldout.json').read_bytes()) == m['freeze']['sha256'], 'Heldout metadata seal mismatch')
require(m['freeze']['previousManifestSha256'] == oldm['freeze']['sha256'], 'Historical seal identity changed')
newdev = m['assets'][len(oldm['assets']):]
newhold = h['assets'][len(oldh['assets']):]
require(len(newdev) == 26 and len(newhold) == 3, 'Additional file allocation mismatch')
require(len(m['families']) - len(oldm['families']) == 18 and len(h['families']) - len(oldh['families']) == 3, 'Additional family allocation mismatch')
require(len({a['id'] for a in m['assets'] + h['assets']}) == 37, 'Duplicate asset ID')
require(len({f['id'] for f in m['families'] + h['families']}) == 26, 'Duplicate family ID')
require(not ({a['original']['sha256'] for a in m['assets']} & {a['original']['sha256'] for a in h['assets']}), 'Original bytes cross the dev/heldout split')
require(counts['wholePack'] == m['fileCounts'] == {'development': 32, 'heldout': 5, 'total': 37, 'families': 26}, 'Whole-pack counts mismatch')
require(counts['additional']['files'] == 29 and counts['additional']['formats'] == {'CSV': 23, 'XLSX': 6}, 'Additional counts mismatch')
require(all(set(x) == {'id', 'publisher', 'fileCount', 'caseNames'} for x in m['heldout']), 'Public blind summary leaks extra keys')
require(all(a['split'] == 'dev' for a in m['assets']) and all(a['split'] in ('holdout', 'heldout') for a in h['assets']), 'Split roles inconsistent')

csv_count = workbook_count = quote_count = 0
actual_numbered, actual_lakh, area_captions = [], [], []
for a in newdev:
    data = pinned(a['original'], a['id'])
    require((ROOT / a['developmentCopy']).read_bytes() == data, a['id'] + ': development copy changed bytes')
    require(a['purpose'] == 'test_only' and a['permission']['state'] == 'unconfirmed', 'New development overqualified')
    require(a['sourceSchema']['canonicalTargets'] is None and a['sourceSchema']['evaluationEligible'] is False, 'Development inferred an oracle')
    if a['mediaType'] == 'text/csv':
        csv_count += 1
        rows = list(csv.reader(io.StringIO(data.decode('utf-8-sig'), newline='')))
        require(rows[0] == a['sourceSchema']['csvHeader'], a['id'] + ': header profile drift')
        require(not any(re.search(r'telephone|pseudocode|submission_time|aadhaar|owner.?name|applicant', c, re.I) for c in rows[0]), a['id'] + ': excluded register class admitted')
        numbered = len(rows) > 1 and [v.strip() for v in rows[1]] == [str(i) for i in range(1, len(rows[0]) + 1)]
        require(numbered == any(c['name'] == 'numbered_header_row' for c in a['cases']), a['id'] + ': numeric data row mislabeled as numbered header')
        if numbered:
            actual_numbered.append(a['id'])
        for case in a['cases']:
            if case['name'] == 'lakh_grouped_numeric_cells':
                i, j = map(int, re.fullmatch(r'CSV record (\d+) column (\d+)', case['locator']).groups())
                require(rows[i - 1][j - 1] == case['literal'], 'Lakh cell citation mismatch')
                require(re.fullmatch(r'\d{1,2}(?:,\d{2})+,\d{3}', case['literal'].strip()) is not None, 'Lakh case invented')
                actual_lakh.append(a['id'])
        pinned(a['publisherMetadata'], a['id'] + ' publisher metadata')
    else:
        workbook_count += 1
        cells = xlsx(data)[0]
        pinned(a['dictionary'], a['id'] + ' publisher document')
        for header in a['sourceSchema']['headerCellLiterals']:
            require(str(header['literal']) == cells.get(header['locator']), 'Development workbook header citation mismatch')
        caption = a['sourceSchema']['unitCaption']
        require(cells[caption['locator']] == caption['literal'] and 'hectare' in caption['literal'].lower(), 'Hectare source caption mismatch')
        area_captions.append(a['id'])
require(csv_count == 23 and workbook_count == 3 and actual_lakh and len(area_captions) == 3, 'Native inputs/cases not present')

# Regression for the actual numeric-majority profiling bug: real land-use records
# and real GDDP data rows must not be reclassified as numbered header rows.
landuse = next(a for a in newdev if any(c['name'] == 'publisher_code_lookup' for c in a['cases']))
require(not any(c['name'] == 'numbered_header_row' for c in landuse['cases']), 'Land-use data row header regression')
require(actual_numbered, 'Real numbered source header row missing')

for a in newhold:
    data = pinned(a['original'], a['family'])
    pinned(a['dictionary'], a['family'] + ' publisher document')
    cells = xlsx(data)
    workbook_count += 1
    require(a['purpose'] == 'test_only' and a['permission']['state'] == 'unconfirmed', 'Closed source overqualified')
    require(a['sourceSchemas'], 'Closed publisher column descriptions absent')
    for schema in a['sourceSchemas']:
        grid = cells[schema['worksheetOrdinal'] - 1]
        for column in schema['columns']:
            require(column['documentationUrl'] == a['origin']['url'] and column['publisherMeaning'] and column['canonicalTarget'] is None, 'Closed field oracle overqualified or undocumented')
            require(column['publisherMeaning'] == ' / '.join(q['text'] for q in column['publisherQuotes']), 'Closed description not assembled solely from publisher quotes')
            for quote in column['publisherQuotes']:
                require(grid.get(quote['locator'], '').strip() == quote['text'], 'Closed publisher header quote mismatch')
                quote_count += 1
            require(column['evaluationScope'].startswith('Publisher-described field identity only'), 'Closed oracle expansion')
        for quote in schema['contextQuotes']:
            require(grid.get(quote['locator']) == quote['text'], 'Closed publisher context quote mismatch')
require(workbook_count == 6, 'Native workbook count mismatch')
require(len(ledger['admittedDevelopmentAcquisitions']) == 26 and len(ledger['teacherBlindAcquisitions']) == 3 and len(ledger['excludedDevelopmentCandidates']) == 5, 'Acquisition/exclusion counts mismatch')
for entry in ledger['excludedDevelopmentCandidates']:
    pinned(entry, 'Excluded retained candidate')
require(not ({e['sha256'] for e in ledger['excludedDevelopmentCandidates']} & {a['original']['sha256'] for a in m['assets'] + h['assets']}), 'Excluded candidate admitted')

catalogue = load(ROOT / 'docs/api/datasets.json')
oldcat = baseline('docs/api/datasets.json')
changed = {'d1-messy-india-development-20261010', 'd1-messy-india-heldout-20261010', 'd1b-messy-india-acquisition-ledger-20261010'}
require([e for e in oldcat['retainedExternalSources'] if e.get('id') not in changed] == [e for e in catalogue['retainedExternalSources'] if e.get('id') not in changed], 'Unrelated catalogue records changed')
require(all(oldcat[k] == catalogue[k] for k in oldcat if k != 'retainedExternalSources'), 'Unrelated catalogue top-level content changed')
for e in catalogue['retainedExternalSources']:
    if e.get('id') in changed:
        require(e['manifestSha256'] == sha((ROOT / e['manifest']).read_bytes()), 'Catalogue metadata pin mismatch')
        require(e['runtimeVerified'] is False and e['apiInstallation'] == 'not-installed', 'Catalogue claims runtime admission')
missing = m['missingCapabilities']
require('lakh_grouped_numeric_cells' not in missing and 'acre_or_hectare_areas' not in missing, 'Observed capability still marked absent')
require('Devanagari_digits' in missing and 'DD/MM/YYYY_record_dates' in missing, 'Absent capability silently qualified')
result = {'checks': 'passed', 'verifiedAdditionalOriginals': 29, 'unchangedDevelopmentCopies': 26, 'nativeCsvFiles': csv_count, 'nativeXlsxFiles': workbook_count, 'publisherHeaderQuoteChecks': quote_count, 'realNumberedHeaderInputs': len(actual_numbered), 'realLakhInputs': len(actual_lakh), 'realHectareCaptionInputs': len(area_captions), 'historicalMetadataPreserved': True, 'historicalOriginalRehashCampaign': False, 'blindSealVerified': True, 'cataloguePreservationVerified': True, 'privacyExcludedFiles': 5, 'runtimeOrTeacherOrModelGateRun': False}
print(json.dumps(result, indent=2))
