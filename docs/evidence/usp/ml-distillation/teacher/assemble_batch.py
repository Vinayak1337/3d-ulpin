"""Build the small teacher-authored seed from pinned training evidence only.

No inference, training, network, augmentation, or canonical records. The exact
coordinator schema is the contract; the lightweight checker covers its keywords
and fails if an unsupported validation keyword is introduced.
"""
import hashlib
import html
import json
import re
from pathlib import Path

from prepare_inventory import ROOT, OUT, PRIVATE, COORDINATOR_COMMIT, load_contracts, pin, read, write


def compact(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def immutable_artifact(path, data):
    if path.exists() and path.read_bytes() != data:
        raise ValueError(f'Existing teacher artifact differs: {path}. Use a new batch version.')
    if not path.exists():
        path.write_bytes(data)


def schema_check(value, rule, schema, location='$'):
    """Check the frozen schema's vocabulary, without hard-coding its enums."""
    supported = {'$schema', '$id', '$defs', 'title', 'description', '$ref', 'type',
                 'required', 'properties', 'additionalProperties', 'minLength',
                 'maxLength', 'pattern', 'enum', 'const', 'items', 'minItems',
                 'maxItems', 'allOf', 'if', 'then', 'oneOf'}
    unsupported = set(rule) - supported
    if unsupported:
        raise ValueError(f'Unsupported schema keywords: {unsupported}')
    if '$ref' in rule:
        target = schema
        for component in rule['$ref'].removeprefix('#/').split('/'):
            target = target[component]
        return schema_check(value, target, schema, location)
    kinds = {'object': lambda x: isinstance(x, dict), 'array': lambda x: isinstance(x, list),
             'string': lambda x: isinstance(x, str), 'null': lambda x: x is None}
    types = rule.get('type')
    if types:
        types = [types] if isinstance(types, str) else types
        if not any(kinds[kind](value) for kind in types):
            raise ValueError(f'{location}: invalid type')
    if 'enum' in rule and value not in rule['enum']:
        raise ValueError(f'{location}: invalid enum')
    if 'const' in rule and value != rule['const']:
        raise ValueError(f'{location}: invalid const')
    if isinstance(value, str):
        if not rule.get('minLength', 0) <= len(value) <= rule.get('maxLength', float('inf')):
            raise ValueError(f'{location}: string length')
        if 'pattern' in rule and not re.search(rule['pattern'], value):
            raise ValueError(f'{location}: pattern')
    if isinstance(value, dict):
        if set(rule.get('required', [])) - set(value):
            raise ValueError(f'{location}: missing fields')
        properties = rule.get('properties', {})
        if rule.get('additionalProperties') is False and set(value) - set(properties):
            raise ValueError(f'{location}: additional fields')
        for key in properties.keys() & value.keys():
            schema_check(value[key], properties[key], schema, f'{location}.{key}')
    if isinstance(value, list):
        if not rule.get('minItems', 0) <= len(value) <= rule.get('maxItems', float('inf')):
            raise ValueError(f'{location}: item count')
        for index, item in enumerate(value):
            schema_check(item, rule.get('items', {}), schema, f'{location}[{index}]')
    for child in rule.get('allOf', []):
        schema_check(value, child, schema, location)
    if 'if' in rule:
        try:
            schema_check(value, rule['if'], schema, location)
        except ValueError:
            pass
        else:
            schema_check(value, rule.get('then', {}), schema, location)
    if 'oneOf' in rule:
        matches = 0
        for child in rule['oneOf']:
            try:
                schema_check(value, child, schema, location)
                matches += 1
            except ValueError:
                pass
        if matches != 1:
            raise ValueError(f'{location}: oneOf count {matches}')


class Batch:
    def __init__(self):
        self.schema, self.freeze, self.contract_pins = load_contracts()
        self.sources = {s['sourceId']: s for s in self.freeze['sources'] if s['split'] == 'train'}
        self.original_checks = {}
        self.artifact_checks = {}
        self.context = read('docs/evidence/usp/plan-context-inputs/index.json')
        self.entries = {s['id']: s for s in self.context['selections']}
        self.annotations = read('docs/evidence/usp/association-sources/observations.json')['observations']
        self.crosswalk = read('docs/evidence/usp/association-crosswalk/observations.json')['observations']
        self.fragments = {}
        self.records = []
        self.rejects = []
        self.machine_checks = []

    def artifact(self, path, expected=None):
        path = str(path)
        if path not in self.artifact_checks:
            self.artifact_checks[path] = pin(path)
        observed = self.artifact_checks[path]
        if expected and any(observed[k] != v for k, v in expected.items()):
            raise ValueError(f'Artifact pin mismatch: {path}')
        return observed

    def source(self, source_id):
        source = self.sources[source_id]  # sealed splits are never addressable here
        path = source['originalPath']
        if path not in self.original_checks:
            observed = pin(path)
            if observed['sha256'] != source['sourceSha256']:
                raise ValueError(f'Original mismatch: {source_id}')
            self.original_checks[path] = observed
        return source

    def fragment(self, key, source_id, method, locator, text):
        source = self.source(source_id)
        if key in self.fragments:
            raise ValueError(f'Duplicate fragment key: {key}')
        fragment = {'key': key, 'familyId': source['familyId'],
                    'sourceSha256': source['sourceSha256'], 'method': method,
                    'locator': locator, 'text': text}
        schema_check(fragment, self.schema['$defs']['fragment'], self.schema)
        self.fragments[key] = fragment
        return key

    def ocr(self, selection, ordinal, source_id):
        entry = self.entries[selection]
        candidate_path = entry['candidate']['path']
        self.artifact(candidate_path, {k: entry['candidate'][k] for k in ('bytes', 'sha256')})
        self.artifact(entry['receipt']['path'], {k: entry['receipt'][k] for k in ('bytes', 'sha256')})
        candidate = json.loads(Path(candidate_path).read_text(encoding='utf-8'))
        item = candidate['items'][ordinal]
        source = self.source(source_id)
        if candidate['sourceSha256'] != source['sourceSha256']:
            raise ValueError('Candidate/source mismatch')
        item_hash = hashlib.sha256(compact(item)).hexdigest()
        indexed = next((o for o in self.context['observations']
                        if o['selection'] == selection and o['ordinal'] == ordinal), None)
        if indexed and (indexed['itemSha256'] != item_hash or indexed['text'] != item['text']):
            raise ValueError('Candidate/index item mismatch')
        self.machine_checks.append({'selection': selection, 'ordinal': ordinal,
                                    'itemSha256': item_hash, 'exactText': True})
        return self.fragment(f'{selection}:item-{ordinal}', source_id, 'ocr_observation',
            {'page': candidate['sourcePage'], 'sourcePageBoxes': item['sourcePageBoxes'],
             'sourcePageFrame': candidate['sourcePageFrame'],
             'selectedRegion': candidate['selection']['sourcePageBox'],
             'candidatePath': candidate_path, 'candidateSha256': entry['candidate']['sha256'],
             'receiptPath': entry['receipt']['path'], 'receiptSha256': entry['receipt']['sha256'],
             'itemOrdinal': ordinal, 'itemSha256': item_hash,
             'readerMethod': item['method'], 'textCompleteness': 'unverified'}, item['text'])

    def annotation(self, key, source_id, review_kind, observation_id, index):
        objects = self.annotations if review_kind == 'source' else self.crosswalk
        obs = next(o for o in objects if o['id'] == observation_id)
        if review_kind == 'source':
            if obs['sourceSha256'] != self.source(source_id)['sourceSha256']:
                raise ValueError('Retained source annotation/original pin mismatch')
            citation = obs['citations'][index]
            text, page, region = citation['literalText'], citation['page'], citation['region']
            pointer = f'/observations/{objects.index(obs)}/citations/{index}/literalText'
            review_path = 'docs/evidence/usp/association-sources/observations.json'
            acceptance = 'docs/evidence/usp/association-sources/independent-review.md'
        else:
            text = obs['visibleText'][index]
            # Explicit map; summary indices and evidence-region indices are not interchangeable.
            if observation_id == 'bihar-layout-type-only':
                evidence_index = 0
            elif observation_id == 'haryana-site-floor-conflict':
                evidence_index = [0, 1, 1, 2][index]
            else:
                evidence_index = {('bihar-land-grouped-identifiers', 1): 3}.get((observation_id, index), index)
            citation = obs['evidence'][evidence_index]
            page, region = citation['page'], citation['region']
            pointer = f'/observations/{objects.index(obs)}/visibleText/{index}'
            review_path = 'docs/evidence/usp/association-crosswalk/observations.json'
            acceptance = 'docs/evidence/usp/association-crosswalk/review.md'
            if citation['sha256'] != self.source(source_id)['sourceSha256']:
                raise ValueError('Review/source pin mismatch')
        review_pin = self.artifact(ROOT / review_path)
        return self.fragment(key, source_id, 'source_supported_annotation',
            {'page': page, 'regionDescription': region,
             'reviewPath': review_path, 'reviewJsonPointer': pointer,
             'reviewSha256': review_pin['sha256'], 'acceptanceReview': acceptance,
             'annotationOrigin': 'retained_visual_review; contextual separators may be reviewer-authored'}, text)

    def html_span(self, key, source_id, span_id):
        source = self.source(source_id)
        raw = Path(source['originalPath']).read_bytes().decode('utf-8')
        match = re.search(r'<span\b[^>]*\bid="' + re.escape(span_id) + r'"[^>]*>([^<]*)</span>', raw)
        if not match:
            raise ValueError(f'Missing simple source span {span_id}')
        return self.fragment(key, source_id, 'native_text',
            {'htmlElementId': span_id, 'rawCharacterStart': match.start(1),
             'rawCharacterEnd': match.end(1), 'reader': 'utf8-simple-html-span/1',
             'transformation': 'HTML character-reference decoding only'}, html.unescape(match.group(1)))

    def table_cell(self, key, index):
        source_id = 'bihar-project.html'
        source = self.source(source_id)
        raw = Path(source['originalPath']).read_bytes().decode('utf-8')
        table = re.search(r'<table\b[^>]*\bid="GV_Building"[^>]*>(.*?)</table>', raw, re.S)
        cells = list(re.finditer(r'<td\b[^>]*>([^<]*)</td>', table.group(1)))
        headers = [html.unescape(m.group(1)) for m in re.finditer(r'<th\b[^>]*>([^<]*)</th>', table.group(1))]
        cell = cells[index]
        start = table.start(1) + cell.start(1)
        return self.fragment(key, source_id, 'native_text',
            {'htmlTableId': 'GV_Building', 'row': 2, 'column': index + 1,
             'columnLabel': headers[index], 'rawCharacterStart': start,
             'rawCharacterEnd': table.start(1) + cell.end(1),
             'reader': 'utf8-simple-html-table/1', 'transformation': 'HTML character-reference decoding only'},
             html.unescape(cell.group(1)))

    def html_literal(self, key, literal, occurrence=0):
        source_id = 'haryana-2831-project.html'
        source = self.source(source_id)
        raw = Path(source['originalPath']).read_bytes().decode('utf-8')
        positions = [m.start() for m in re.finditer(re.escape(literal), raw)]
        start = positions[occurrence]
        return self.fragment(key, source_id, 'native_text',
            {'rawCharacterStart': start, 'rawCharacterEnd': start + len(literal),
             'reader': 'utf8-literal-span/1', 'transformation': 'none'}, literal)

    def cite(self, key, quote=None):
        return {'key': key, 'quote': self.fragments[key]['text'] if quote is None else quote}

    def claim(self, role, literal, key, state='declared', unit=None, quote=None):
        return {'role': role, 'state': state, 'literal': literal, 'unit': unit,
                'citations': [self.cite(key, quote)]}

    def decision(self, code, *keys):
        return {'code': code, 'citations': [self.cite(k) for k in keys]}

    def add(self, example_id, keys, claims, explanation, conflicts=None, abstentions=None):
        evidence = [self.fragments[k] for k in keys]
        families = {e['familyId'] for e in evidence}
        if len(families) != 1:
            raise ValueError('Training example crosses project family')
        model_input = {'version': 'evidence-association-input/1', 'exampleId': example_id,
                       'familyId': next(iter(families)), 'evidence': evidence}
        output = {'version': 'evidence-association-output/1', 'claims': claims,
                  'conflicts': conflicts or [], 'abstentions': abstentions or [], 'canonicalLinks': []}
        schema_check(model_input, self.schema['$defs']['input'], self.schema)
        schema_check(output, self.schema['$defs']['output'], self.schema)
        by_key = {fragment['key']: fragment for fragment in evidence}
        for obj in output['claims'] + output['conflicts'] + output['abstentions']:
            for citation in obj['citations']:
                if citation['key'] not in by_key or citation['quote'] not in by_key[citation['key']]['text']:
                    raise ValueError('Unsupported citation')
            if 'role' in obj:
                quotes = [c['quote'] for c in obj['citations']]
                for field in ('literal', 'unit'):
                    if obj[field] is not None and not any(obj[field] in quote for quote in quotes):
                        raise ValueError(f'Unsupported exact {field}')
                if obj['state'] in ('unknown', 'absent', 'null', 'withheld') and obj['literal'] is not None:
                    raise ValueError('Missing-state claim must not invent a value')
        lineage = [s for s in self.sources.values() if s['sourceSha256'] in {f['sourceSha256'] for f in evidence}]
        record = {'input': model_input, 'output': output,
                  'supervision': {'version': 'ml-distill-teacher-supervision/1', 'split': 'train',
                    'state': 'provisional_synthetic_supervision', 'reviewState': 'needs_independent_review',
                    'validationState': 'syntax_citation_literal_identifier_unit_checked',
                    'teacher': {'role': 'dedicated_ML_teacher', 'requestedModel': 'gpt-6.1-sol',
                                'requestedReasoning': 'max', 'observedModelReasoningTier': 'unexposed',
                                'requiredSpeed': 'default/standard', 'method': 'task_teacher_authored/1'},
                    'schemaSha256': self.contract_pins['schema'], 'freezeSha256': self.contract_pins['freeze'],
                    'coordinatorCommit': COORDINATOR_COMMIT, 'sourceLineage': lineage,
                    'explanation': explanation, 'qualification': 'not_assessed',
                    'canonicalMatchState': 'not_assessed', 'sarvamDerived': False, 'augmentation': False}}
        self.records.append(record)

    def reject(self, key, reason):
        self.rejects.append({'kind': 'rejected_ocr_interpretation', 'evidence': self.fragments[key],
                             'reason': reason, 'acceptedInterpretation': None, 'split': 'train',
                             'state': 'rejected_for_claim_generation', 'includedInFit': False,
                             'notAReplacementOriginal': True})


def build(batch):
    b = batch
    title = b.ocr('t3-2-title', 8, 'haryana-2831-tower3-plan2.pdf')
    heading = b.ocr('t3-2-floor01', 3, 'haryana-2831-tower3-plan2.pdf')
    floors = b.ocr('t3-2-floor01', 4, 'haryana-2831-tower3-plan2.pdf')
    literals = ['3rd to 12th', '14th to 16th', '18th to 20th', '22nd to 25th', '27th',
                '29th', '31st to 34th', '36th to 37th', '39th to 41st']
    b.add('teacher-haryana-floor01', [title, heading, floors],
          [b.claim('building', 'TOWER03', title), b.claim('drawing', 'TYPICAL FLOOR - 01', heading)] +
          [b.claim('floor', literal, floors) for literal in literals],
          'Planned source-native scope. Each printed range/list occurrence stays literal; ranges are not expanded and omitted floors/units are not invented.')
    floor02 = b.ocr('t3-2-floor02-reused', 0, 'haryana-2831-tower3-plan2.pdf')
    b.add('teacher-haryana-floor02', [title, floor02],
          [b.claim('building', 'TOWER03', title), b.claim('drawing', 'TYPICAL FLOOR - 02', floor02)] +
          [b.claim('floor', literal, floor02) for literal in ['13rd', '21st', '30th', '38th']],
          'Four printed floor occurrences. Preserve 13rd exactly; 02 names the typical drawing, not the building second floor.')
    project = b.ocr('t3-2-title', 1, 'haryana-2831-tower3-plan2.pdf')
    drawing = b.ocr('t3-2-title', 9, 'haryana-2831-tower3-plan2.pdf')
    date = b.ocr('t3-2-title', 11, 'haryana-2831-tower3-plan2.pdf')
    token = b.ocr('t3-2-title', 16, 'haryana-2831-tower3-plan2.pdf')
    b.add('teacher-haryana-title02', [project, title, drawing, date, token],
          [b.claim('project', 'PROPOSED BUILDING PLAN FOR RESIDENTIAL COLONY', project),
           b.claim('building', 'TOWER03', title), b.claim('drawing', 'PLAN & AREA CALCULATION', drawing),
           b.claim('area', '10.071875 ACRES', project, unit='ACRES'),
           b.claim('area', '7.434375 Acres', project, unit='Acres'),
           b.claim('area', '2.6375 Acres', project, unit='Acres'),
           b.claim('source_identifier', 'LICENSE NO. 225 OF 2023', project),
           b.claim('source_identifier', 'LICENSE NO. 92 OF 2023', project),
           b.claim('source_identifier', None, token, state='unknown'),
           b.claim('revision', None, date, state='unknown')],
          'Amounts and units retain case/spelling without conversion. No developer/architect office unit, sheet ID or current approved revision is inferred from noisy OCR.',
          abstentions=[b.decision('uncertain_sheet_identifier', token), b.decision('approval_revision_unresolved', date)])
    t4_title = b.ocr('t3-4-title', 10, 'haryana-2831-tower3-section.pdf')
    t4_drawing = b.ocr('t3-4-title', 11, 'haryana-2831-tower3-section.pdf')
    t4_date = b.ocr('t3-4-title', 13, 'haryana-2831-tower3-section.pdf')
    t4_token = b.ocr('t3-4-title', 15, 'haryana-2831-tower3-section.pdf')
    b.add('teacher-haryana-section-title', [t4_title, t4_drawing, t4_date, t4_token],
          [b.claim('building', 'TOWER-3', t4_title), b.claim('drawing', 'SECTION & ELEVATION', t4_drawing),
           b.claim('source_identifier', None, t4_token, state='unknown'),
           b.claim('revision', None, t4_date, state='unknown')],
          'The emitted T34 loses separators and SCALE/date are merged. Keep raw OCR; do not substitute a reviewed T3-4 identifier or current approval.',
          abstentions=[b.decision('uncertain_sheet_identifier', t4_token), b.decision('merged_date_scale_ocr', t4_date)])
    plan_keys = [b.annotation(f't3-1:review-{i}', 'haryana-2831-tower3-plan1.pdf', 'source',
                             'haryana-2831-tower3-plan', i) for i in range(3)]
    b.add('teacher-haryana-refuge-multifloor', plan_keys,
          [b.claim('building', 'TOWER-03', plan_keys[2]),
           b.claim('source_identifier', 'T3-1', plan_keys[2]),
           b.claim('floor', '2ND FLOOR PLAN', plan_keys[0])] +
          [b.claim('floor', literal, plan_keys[1]) for literal in ['17th', '26th', '35th']],
          'Retained accepted visual annotation, separate from OCR. Refuge scope names three planned floor occurrences and does not identify a legal unit.')
    site_keys = [b.annotation(f'site:review-{i}', 'haryana-2831-site-plan.pdf', 'crosswalk',
                             'haryana-site-floor-conflict', i) for i in range(3)]
    b.add('teacher-haryana-site-conflict', site_keys,
          [b.claim('building', 'T-3', site_keys[0]),
           b.claim('level', 'G+41', site_keys[0], state='conflicting'),
           b.claim('level', 'G+42', site_keys[1], state='conflicting')],
          'The tower graphic and both tables disagree in one retained planned sheet. G+ labels are floor-count expressions, not metric height or a selected approved/built count.',
          conflicts=[b.decision('tower_floor_count_conflict', *site_keys)],
          abstentions=[b.decision('approved_or_built_floor_count_unresolved', *site_keys)])
    villa_keys = [b.annotation(f'villa5:review-{i}', 'bihar-magnolia-sanctioned-layout.pdf', 'source',
                              'bihar-villa-type5-multilevel', i) for i in range(2)]
    b.add('teacher-bihar-type5-multilevel', villa_keys,
          [b.claim('building_type', 'VILLA TYPE 5', villa_keys[1]),
           b.claim('source_identifier', 'V5-02', villa_keys[1]),
           b.claim('unit', None, villa_keys[1], state='unknown')] +
          [b.claim('floor', literal, villa_keys[0]) for literal in
           ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN', 'TERRACE FLOOR PLAN']],
          'Four type-level planned levels are labelled. Blank unit number does not select any numbered villa, and terrace is not asserted to be a separate legal unit.',
          abstentions=[b.decision('numbered_villa_unknown', villa_keys[1])])
    land_html = b.html_span('bihar:land-html', 'bihar-project.html', 'Label134')
    khata = b.annotation('bihar:title-land-identifiers', 'bihar-approved-layout.pdf', 'crosswalk',
                        'bihar-layout-type-only', 1)
    jamabandi = b.annotation('bihar:title-jamabandi', 'bihar-approved-layout.pdf', 'crosswalk',
                            'bihar-layout-type-only', 2)
    grouped = b.annotation('bihar:grouped-land', 'bihar-land-location.pdf', 'crosswalk',
                          'bihar-land-grouped-identifiers', 1)
    b.add('teacher-bihar-identifier-conflict', [land_html, khata, jamabandi, grouped],
          [b.claim('source_identifier', 'KHATA NO.-35', khata),
           b.claim('source_identifier', 'Khata no 40', land_html),
           b.claim('source_identifier', 'JAMABANDI 333', jamabandi, state='conflicting'),
           b.claim('source_identifier', 'Jamabandi no  330', land_html, state='conflicting'),
           b.claim('source_identifier', 'Khata 212, 35, 40', grouped),
           b.claim('source_identifier', 'Khesra 1641, 1659, 1660', grouped)],
          'Grouped land context includes both Khata values but does not establish one-to-one parcel mappings or correct Jamabandi 333/330. Exact double space in HTML is retained.',
          conflicts=[b.decision('jamabandi_identifier_conflict', jamabandi, land_html)],
          abstentions=[b.decision('grouped_identifiers_not_one_to_one', grouped)])
    cells = [b.table_cell(f'bihar:building-cell-{i}', i) for i in range(7)]
    b.add('teacher-bihar-table-units-missing', cells,
          [b.claim('building', 'Magnolia Residency', cells[0])] +
          [b.claim('area', b.fragments[key]['text'], key) for key in cells[4:]],
          'Literal project-table building label and three amounts. No unit is supplied by these headers/cells, and counts do not become floor labels, villa numbers or a per-villa crosswalk.',
          abstentions=[b.decision('area_units_missing', *cells[4:]), b.decision('per_villa_mapping_missing', cells[0], cells[3])])
    portal_keys = [b.html_literal(f'haryana:portal-drawing-{i}', text) for i, text in enumerate([
        'BUILDING PLAN-TOWER-3 PLAN-1', 'BUILDING PLAN-TOWER-3 PLAN-2', 'BUILDING PLAN-TOWER-3 SECTION ELEVATION'])]
    approval = b.html_literal('haryana:portal-approval-date', '29-04-2024')
    upload = b.html_literal('haryana:portal-upload-date', '29-08-2024')
    b.add('teacher-haryana-portal-revision-gap', portal_keys + [approval, upload],
          [b.claim('drawing', b.fragments[key]['text'], key) for key in portal_keys] +
          [b.claim('revision', None, approval, state='unknown')],
          'The portal groups the three planned tower attachments. Approval-field and upload-list dates do not identify an exact currently approved sheet/revision set.',
          abstentions=[b.decision('approval_date_not_sheet_revision', approval, upload)])
    map_date = b.html_span('bihar:approval-date', 'bihar-project.html', 'txtMapdate')
    b.add('teacher-bihar-unusable-approval-date', [map_date],
          [b.claim('revision', None, map_date, state='unknown')],
          'Displayed 1899-12-30 is retained without diagnosing its cause or accepting it as a usable approval revision.',
          abstentions=[b.decision('approval_date_unusable', map_date)])
    b.reject(token, 'TH is unreliable for sheet identifier; no supported exact identifier interpretation.')
    b.reject(t4_token, 'T34 loses separators; exact reviewed sheet spelling is not silently substituted.')
    for ordinal in range(3):
        key = b.ocr('t3-2-floor01', ordinal, 'haryana-2831-tower3-plan2.pdf')
        b.reject(key, 'Raw emitted crop noise does not support a floor/unit/identifier claim.')


def main():
    batch = Batch()
    build(batch)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    for filename, records in [('train-teacher-v1.jsonl', batch.records), ('rejected-interpretations-v1.jsonl', batch.rejects)]:
        data = b''.join(compact(record) + b'\n' for record in records)
        immutable_artifact(PRIVATE / filename, data)
    claims = sum(len(r['output']['claims']) for r in batch.records)
    receipt = {'version': 'ml-teacher-batch-validation/1', 'examples': len(batch.records), 'claims': claims,
               'conflicts': sum(len(r['output']['conflicts']) for r in batch.records),
               'abstentions': sum(len(r['output']['abstentions']) for r in batch.records),
               'rejects': len(batch.rejects), 'machineLiteralChecks': batch.machine_checks,
               'originalChecks': batch.original_checks, 'artifactChecks': batch.artifact_checks,
               'checks': ['frozen_schema_keywords', 'train_family_membership', 'raw_original_sha256',
                          'candidate_receipt_item_pins', 'citation_quote_substrings', 'literal_identifier_unit_substrings',
                          'multiple_floor_literals_not_expanded', 'no_canonical_links', 'provisional_provenance'],
               'notChecked': ['independent_training_label_truth', 'generalization', 'canonical_matching', 'learning_fit', 'deployment'],
               'schemaHashConvention': 'canonical LF Git blob', 'sourceHashConvention': 'unchanged raw original bytes',
               'coordinatorCommit': COORDINATOR_COMMIT, 'contractPins': batch.contract_pins,
               'sourceSpotCheck': {'kind': 'machine_output_comparison', 'selection': 't3-2-floor02-reused',
                 'ordinal': 0, 'candidateSha256': '3fef032598e08a90c61eb7c6bd1afd64bf32650d78fb673d83bfe9864f3faab3',
                 'itemSha256': '770fb5cd4abb2ceb9d0f56632738d1030c68bf61bfd37ecee9ac1bbd9519c901',
                 'exactText': 'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)',
                 'check': 'Original retained candidate bytes/item compare exactly to immutable source-context index; printed typo preserved.'}}
    immutable_artifact(PRIVATE / 'validation-v1-final.json',
                       (json.dumps(receipt, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
    visual_path = Path('E:/BhuAayam-data/task-data/association-crosswalk-20260930/review-recovery/haryana-plan2-floor02.jpg')
    visual_pin = pin(visual_path)
    if visual_pin != {'bytes': 14303, 'sha256': '8461b09efdc49f7406fd949eef6c1402184dede7f18d330824278e083da840ae'}:
        raise ValueError('Retained spot-check render pin mismatch')
    spot_check = {'version': 'ml-teacher-source-spot-check/1', 'exampleId': 'teacher-haryana-floor02',
                  'sourceSha256': '2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1',
                  'page': 1, 'regionDescription': 'Right/main Typical Floor-02 caption',
                  'renderPath': str(visual_path), **visual_pin,
                  'renderIndex': 'E:/BhuAayam-data/task-data/association-crosswalk-20260930/review-recovery/image-index.json',
                  'observed': 'TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)',
                  'method': 'Direct view of retained original-derived crop, separately from teacher output; raw candidate/item pins also match.',
                  'outcome': 'Printed 13rd and the four floor occurrences agree; no correction to 13th or canonical interpretation.',
                  'qualification': 'one literal/source check only; not independent truth for all teacher claims'}
    immutable_artifact(PRIVATE / 'spot-check-v1.json',
                       (json.dumps(spot_check, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
    paths = [PRIVATE / 'train-teacher-v1.jsonl', PRIVATE / 'rejected-interpretations-v1.jsonl',
             PRIVATE / 'validation-v1-final.json', PRIVATE / 'spot-check-v1.json']
    manifest = {'version': 'ml-distill-teacher-batch/1', 'createdDate': '2026-10-02',
                'status': 'provisional_synthetic_supervision', 'split': 'train',
                'familyIds': sorted({r['input']['familyId'] for r in batch.records}),
                'coordinatorCommit': COORDINATOR_COMMIT, 'contractPins': batch.contract_pins,
                'codePins': {name: hashlib.sha256((OUT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
                             for name in ['assemble_batch.py', 'prepare_inventory.py']},
                'codeHashConvention': 'canonical LF bytes; original/data hashes remain raw',
                'sourceInventory': 'docs/evidence/usp/ml-distillation/teacher/inventory.json (earlier acquisition checkpoint; freeze selects train)',
                'artifacts': [{'path': str(path), **pin(path)} for path in paths],
                'examples': len(batch.records), 'claims': claims, 'rejects': len(batch.rejects),
                'exampleIds': [r['input']['exampleId'] for r in batch.records],
                'teacher': batch.records[0]['supervision']['teacher'],
                'reviewState': 'needs_independent_review', 'validationState': 'passed_local_consistency',
                'inputMethods': sorted({e['method'] for r in batch.records for e in r['input']['evidence']}),
                'unitHandling': 'Exact stated units retained; missing units remain null with abstention, no conversion.',
                'qualification': 'tiny experimental train seed; neither official records nor independent ground truth',
                'evaluationAccess': False, 'devRawAccess': False, 'sarvamDerived': False,
                'sourceSpecificLaunchClearance': 'unconfirmed; user-authorized public local development only'}
    write(OUT / 'batch-v1.manifest.json', manifest)
    write(OUT / 'example-floor02.json', batch.records[1])
    print(json.dumps({'examples': len(batch.records), 'claims': claims,
                      'rejects': len(batch.rejects), 'trainSha256': pin(paths[0])['sha256'],
                      'validation': str(paths[2])}))


if __name__ == '__main__':
    main()
