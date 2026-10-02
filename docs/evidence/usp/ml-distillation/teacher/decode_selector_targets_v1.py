"""Teacher's independent, fail-closed decoder for pinned lexical-span selectors.

Receives source input and selector bytes, never encoder caches or target labels.
No model, prompt, source acquisition or student implementation is involved.
"""
import hashlib
import json
import re

from assemble_batch import compact, schema_check

MISSING_STATES = {'unknown', 'absent', 'null', 'withheld'}


class SelectorFailure(ValueError):
    def __init__(self, stage, path, raw_value, reason):
        super().__init__(f'{stage} {path}: {reason}')
        self.detail = {'stage': stage, 'path': path, 'rawValue': raw_value, 'reason': reason}


def strict_json(raw):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise SelectorFailure('raw_json', '/', key, 'Duplicate JSON member')
            result[key] = value
        return result

    def invalid_constant(value):
        raise SelectorFailure('raw_json', '/', value, 'Non-finite JSON constant')

    if type(raw) not in (bytes, str):
        raise SelectorFailure('raw_json', '/', None, 'Expected raw UTF-8 JSON bytes or text')
    try:
        text = raw.decode('utf-8') if type(raw) is bytes else raw
        return json.loads(text, object_pairs_hook=object_pairs, parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise SelectorFailure('raw_json', '/', None, str(error)) from error


def selector_schema_check(value, rule, schema, path=''):
    """Check only the frozen selector vocabulary; int excludes bool and float."""
    supported = {'$schema', '$id', '$defs', 'title', 'description', '$ref', 'type',
                 'required', 'properties', 'additionalProperties', 'minLength',
                 'maxLength', 'pattern', 'enum', 'const', 'items', 'minItems',
                 'maxItems', 'minimum', 'oneOf'}

    def fail(reason):
        raise SelectorFailure('selector_schema', path or '/', value, reason)

    if set(rule) - supported:
        fail('Unsupported selector schema keywords')
    if '$ref' in rule:
        if not rule['$ref'].startswith('#/'):
            fail('Nonlocal schema reference')
        target = schema
        for component in rule['$ref'][2:].split('/'):
            target = target[component]
        return selector_schema_check(value, target, schema, path)
    types = rule.get('type')
    if types:
        types = [types] if type(types) is str else types
        kinds = {'object': dict, 'array': list, 'string': str, 'null': type(None), 'integer': int}
        if not any(type(value) is kinds[kind] for kind in types):
            fail('Invalid exact JSON type')
    if 'enum' in rule and not any(type(value) is type(item) and value == item for item in rule['enum']):
        fail('Invalid enum')
    if 'const' in rule and (type(value) is not type(rule['const']) or value != rule['const']):
        fail('Invalid const')
    if 'minimum' in rule and type(value) is int and value < rule['minimum']:
        fail('Integer below minimum')
    if type(value) is str:
        if not rule.get('minLength', 0) <= len(value) <= rule.get('maxLength', float('inf')):
            fail('String length')
        if 'pattern' in rule and re.search(rule['pattern'], value) is None:
            fail('String pattern')
    if type(value) is dict:
        if set(rule.get('required', [])) - value.keys():
            fail('Missing fields')
        properties = rule.get('properties', {})
        if rule.get('additionalProperties') is False and value.keys() - properties.keys():
            fail('Additional fields')
        for key, child in properties.items():
            if key in value:
                pointer = key.replace('~', '~0').replace('/', '~1')
                selector_schema_check(value[key], child, schema, path + '/' + pointer)
    if type(value) is list:
        if not rule.get('minItems', 0) <= len(value) <= rule.get('maxItems', float('inf')):
            fail('Item count')
        for index, item in enumerate(value):
            selector_schema_check(item, rule.get('items', {}), schema, path + '/' + str(index))
    if 'oneOf' in rule:
        matches = 0
        for child in rule['oneOf']:
            try:
                selector_schema_check(value, child, schema, path)
                matches += 1
            except SelectorFailure:
                pass
        if matches != 1:
            fail('oneOf match count')


def decode_output(raw, model_input, pattern, selector_schema, original_schema,
                  expected_input_sha256, validate_expanded):
    """Reject the complete output on any JSON/schema/range/source/semantic error."""
    selected = strict_json(raw)
    selector_schema_check(selected, selector_schema['$defs']['output'], selector_schema)
    try:
        schema_check(model_input, original_schema['$defs']['input'], original_schema)
    except ValueError as error:
        raise SelectorFailure('source_input', '/input', None, str(error)) from error
    if hashlib.sha256(compact(model_input)).hexdigest() != expected_input_sha256:
        raise SelectorFailure('source_drift', '/input', None, 'Pinned original input changed')

    # Independently re-lex exact source text; no encoder boundary maps are shared.
    spans = []
    for ordinal, fragment in enumerate(model_input['evidence']):
        positions = []
        cursor = 0
        for match in re.finditer(pattern, fragment['text'], flags=re.UNICODE):
            if match.start() != cursor or match.end() <= cursor:
                raise SelectorFailure('source_lexer', f'/input/evidence/{ordinal}/text', None,
                                      'Lexer does not partition the complete source string')
            positions.append((match.start(), match.end()))
            cursor = match.end()
        if cursor != len(fragment['text']):
            raise SelectorFailure('source_lexer', f'/input/evidence/{ordinal}/text', None,
                                  'Lexer left unmatched source characters')
        spans.append(positions)

    pointers = []
    for section in ('claims', 'conflicts', 'abstentions'):
        for index, decision in enumerate(selected[section]):
            base = f'/{section}/{index}'
            if section == 'claims':
                for field in ('literal', 'unit'):
                    pointer = decision[field]
                    if decision['state'] in MISSING_STATES and pointer is not None:
                        raise SelectorFailure('selector_policy', base + '/' + field, pointer,
                                              'Missing-state literal/unit must stay null')
                    if pointer is not None:
                        pointers.append((base + '/' + field, pointer))
            pointers.extend((base + '/citations/' + str(i), pointer)
                            for i, pointer in enumerate(decision['citations']))

    # Check every pointer before expanding even the first span.
    for path, pointer in pointers:
        if type(pointer) is not list or len(pointer) != 3 or any(type(i) is not int for i in pointer):
            raise SelectorFailure('selector_range', path, pointer, 'Expected exactly three type-int ordinals')
        fragment, first, end = pointer
        if not 0 <= fragment < len(spans) or not 0 <= first < end <= len(spans[fragment]):
            raise SelectorFailure('selector_range', path, pointer, 'Fragment/token bounds or nonempty range failed')

    def expand(pointer):
        fragment, first, end = pointer
        start_char, end_char = spans[fragment][first][0], spans[fragment][end - 1][1]
        return model_input['evidence'][fragment]['text'][start_char:end_char]

    expanded = {'version': 'evidence-association-output/1', 'claims': [], 'conflicts': [],
                'abstentions': [], 'canonicalLinks': selected['canonicalLinks'][:]}
    for section in ('claims', 'conflicts', 'abstentions'):
        for decision in selected[section]:
            if section == 'claims':
                item = {'role': decision['role'], 'state': decision['state'],
                        'literal': None if decision['literal'] is None else expand(decision['literal']),
                        'unit': None if decision['unit'] is None else expand(decision['unit'])}
            else:
                item = {'code': decision['code']}
            item['citations'] = [{'key': model_input['evidence'][pointer[0]]['key'], 'quote': expand(pointer)}
                                 for pointer in decision['citations']]
            expanded[section].append(item)
    try:
        schema_check(expanded, original_schema['$defs']['output'], original_schema)
        validate_expanded(expanded)
    except ValueError as error:
        raise SelectorFailure('expanded_validation', '/output', selected, str(error)) from error
    return expanded
