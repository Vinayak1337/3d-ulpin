"""Bounded source-literal OBJ polygon context; CPython standard library only.

Wavefront B1 syntax and TinyObjLoader's independent index streams informed the
profile. No external statements/resources, triangulation or coordinate defaults
are evaluated. Original-file byte offsets are zero-based and end-exclusive.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

MAX_INPUT_BYTES = MAX_OUTPUT_BYTES = 16 * 1024**2
MAX_VERTICES = MAX_FACES = 100_000
MAX_FACE_REFERENCES = 500_000
MAX_LINES = 300_000
MAX_LINE_BYTES = 64 * 1024
MAX_RECORDS = 250_000
NUMBER = re.compile(rb"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
INTEGER = re.compile(rb"[+-]?[0-9]+\Z")
TOKEN = re.compile(rb"[^ \t]+")
FREE_FORM = {'vp', 'cstype', 'deg', 'bmat', 'step', 'curv', 'curv2', 'surf', 'parm', 'trim', 'hole', 'scrv', 'sp', 'end', 'con'}
EXTERNAL = {'call', 'csh', 'shadow_obj', 'trace_obj', 'maplib', 'usemap'}


class ObjError(ValueError):
    def __init__(self, code, message, locator=None):
        super().__init__(message)
        self.code, self.locator = code, locator

    def as_dict(self):
        return {'code': self.code, 'message': str(self), 'locator': self.locator}


def _fail(code, message, locator=None):
    raise ObjError(code, message, locator)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _statements(raw):
    """Tokenize physical bytes; continuation tokens keep their own exact spans."""
    offset, pending, first, start, continued = 0, [], None, 0, False
    for line_number, physical in enumerate(raw.splitlines(keepends=True), 1):
        if line_number > MAX_LINES or len(physical) > MAX_LINE_BYTES:
            _fail('TEXT_LIMIT', 'Physical line/count exceeds this bounded profile.')
        line = physical.rstrip(b'\r\n')
        if any(v < 32 and v != 9 for v in line) or b'\x7f' in line:
            _fail('TEXT_ENCODING', 'Control/binary bytes are unsupported.', {'line': line_number, 'byteStart': offset})
        begin = 3 if offset == 0 and line.startswith(b'\xef\xbb\xbf') else 0
        content = line[begin:].split(b'#', 1)[0].rstrip(b' \t')
        continued = content.endswith(b'\\')
        if continued:
            if len(content) > 1 and content[-2] not in b' \t':
                _fail('CONTINUATION_PROFILE', 'Continuation requires a token boundary; split tokens are unsupported.', {'line': line_number})
            content = content[:-1]
        tokens = []
        for match in TOKEN.finditer(content):
            a, b = offset + begin + match.start(), offset + begin + match.end()
            tokens.append({'literal': match.group().decode('utf-8'), 'locator': {'byteStart': a, 'byteEnd': b,
                           'line': line_number, 'byteColumnStart': begin + match.start(), 'byteColumnEnd': begin + match.end(),
                           'spanSha256': _sha(raw[a:b])}})
        if tokens and first is None:
            first, start = line_number, offset
        pending.extend(tokens)
        offset += len(physical)
        if continued:
            continue
        if pending:
            yield pending, {'byteStart': start, 'byteEnd': offset, 'lineStart': first, 'lineEnd': line_number,
                            'spanSha256': _sha(raw[start:offset])}, raw[start:offset].decode('utf-8')
        pending, first = [], None
    if pending or continued:
        _fail('CONTINUATION_EOF', 'An unfinished continued statement cannot be inspected.', {'line': first})


def _numbers(fields):
    values = []
    for field in fields:
        encoded = field['literal'].encode('utf-8')
        if len(encoded) > 128 or not NUMBER.fullmatch(encoded):
            _fail('NUMERIC_VALUE', 'Coordinate fields require finite decimal numbers.', field['locator'])
        value = float(encoded)
        if not math.isfinite(value):
            _fail('NONFINITE_VALUE', 'Nonfinite coordinate values cannot become geometry.', field['locator'])
        values.append(value)
    return values


def _reference(field, populations):
    components = field['literal'].split('/')
    form = 'v' if len(components) == 1 else 'v/vt' if len(components) == 2 else 'v//vn' if len(components) == 3 and not components[1] else 'v/vt/vn'
    if len(components) > 3 or not components[0] or (len(components) == 2 and not components[1]) or (len(components) == 3 and not components[2]):
        _fail('INDEX_SYNTAX', 'Use v, v/vt, v//vn or v/vt/vn references.', field['locator'])
    result = {'literal': field['literal'], 'locator': field['locator'], 'form': form}
    offset = 0
    for index, name in enumerate(('vertex', 'texture', 'normal')):
        component = components[index] if index < len(components) else ''
        if not component:
            result[name] = None
        else:
            if len(component) > 16 or not INTEGER.fullmatch(component.encode('utf-8')):
                _fail('INDEX_SYNTAX', 'Index must be a bounded signed integer.', field['locator'])
            value = int(component)
            if value == 0:
                _fail('INDEX_ZERO', 'OBJ indices are one-based or negative relative indices.', field['locator'])
            resolved = value - 1 if value > 0 else populations[index] + value
            if resolved < 0:
                _fail('INDEX_RANGE', 'Relative index precedes its source-order population.', field['locator'])
            locator = dict(field['locator'])
            locator.update(byteStart=locator['byteStart'] + offset, byteEnd=locator['byteStart'] + offset + len(component),
                           byteColumnStart=locator['byteColumnStart'] + offset, byteColumnEnd=locator['byteColumnStart'] + offset + len(component),
                           spanSha256=_sha(component.encode('utf-8')))
            result[name] = {'literal': component, 'sourceIndex': value, 'resolvedIndex': resolved, 'locator': locator}
        offset += len(component) + 1
    return result


def inspect_obj(raw):
    if not raw or len(raw) > MAX_INPUT_BYTES:
        _fail('INPUT_LIMIT', 'Expected a nonempty original of at most 16 MiB.')
    if any(value < 32 and value not in (9, 10, 13) or value == 127 for value in raw):
        _fail('TEXT_ENCODING', 'Control/binary bytes are unsupported.')
    try:
        raw.decode('utf-8')
    except UnicodeDecodeError:
        _fail('TEXT_ENCODING', 'Only unchanged UTF-8/ASCII OBJ text is supported.')
    vertices, textures, normals, faces, declarations, unsupported = [], [], [], [], [], []
    streams = {'v': vertices, 'vt': textures, 'vn': normals}
    active = {'object': None, 'groups': None, 'material': None, 'smoothing': None}
    total_references, has_call = 0, False
    for ordinal, (tokens, locator, literal) in enumerate(_statements(raw)):
        if ordinal >= MAX_RECORDS:
            _fail('RECORD_LIMIT', 'Statement population exceeds this bounded profile.', locator)
        directive, fields = tokens[0]['literal'], tokens[1:]
        record = {'ordinal': ordinal, 'directive': directive, 'literal': literal, 'locator': locator, 'fields': fields}
        if directive in streams:
            if sum(map(len, streams.values())) >= MAX_VERTICES:
                _fail('VERTEX_LIMIT', 'Aggregate v/vt/vn records exceed 100,000.', locator)
            values = _numbers(fields)
            if not values:
                _fail('VERTEX_ARITY', 'A coordinate record must contain values.', locator)
            supported = len(values) in ((3, 4) if directive == 'v' else (1, 2, 3) if directive == 'vt' else (3,))
            record.update(index=len(streams[directive]), values=values, status='source_values' if supported else 'unsupported_profile',
                          reason=None if supported else 'Coordinate arity/vertex-color extension is outside this profile.')
            if directive == 'v':
                record['cartesianProjectionEligible'] = supported and (len(values) == 3 or values[3] == 1)
                if supported and not record['cartesianProjectionEligible']:
                    record['reason'] = 'Homogeneous weight retained; division/coordinate conversion is not performed.'
            streams[directive].append(record)
        elif directive == 'f':
            if len(faces) >= MAX_FACES or total_references + len(fields) > MAX_FACE_REFERENCES:
                _fail('FACE_LIMIT', 'Faces/references exceed 100,000/500,000.', locator)
            if len(fields) < 3:
                _fail('FACE_ARITY', 'Polygon references require at least three vertices.', locator)
            references = [_reference(field, tuple(map(len, (vertices, textures, normals)))) for field in fields]
            if len({reference['form'] for reference in references}) != 1:
                _fail('INDEX_FORM', 'A polygon must use one consistent index form.', locator)
            record.update(index=len(faces), references=references, populationsAtDeclaration={'vertex': len(vertices), 'texture': len(textures), 'normal': len(normals)},
                          declarations=dict(active), projectionEligible=True, projectionReasons=[])
            faces.append(record)
            total_references += len(fields)
        elif directive in {'o', 'g', 's', 'usemtl', 'mtllib'}:
            if directive in {'usemtl', 'mtllib', 's'} and not fields:
                _fail('DECLARATION_ARITY', 'This declaration requires a literal argument.', locator)
            record.update(index=len(declarations), state='declaration_only', arguments=[field['literal'] for field in fields])
            declarations.append(record)
            if directive in {'o', 'g', 's', 'usemtl'}:
                active[{'o': 'object', 'g': 'groups', 's': 'smoothing', 'usemtl': 'material'}[directive]] = record['index']
        else:
            reason = 'Free-form geometry is inventoried without evaluation.' if directive in FREE_FORM else 'External/executable directive is never resolved or executed.' if directive in EXTERNAL else 'Directive is outside the supported polygon profile.'
            record.update(state='unsupported', reason=reason)
            unsupported.append(record)
            has_call |= directive == 'call'
    for face in faces:
        for reference in face['references']:
            for name, stream in (('vertex', vertices), ('texture', textures), ('normal', normals)):
                binding = reference[name]
                if binding is None:
                    continue
                if binding['resolvedIndex'] >= len(stream):
                    _fail('INDEX_RANGE', 'Index does not resolve within this unchanged file.', binding['locator'])
                target = stream[binding['resolvedIndex']]
                if target['status'] != 'source_values' or name == 'vertex' and not target['cartesianProjectionEligible']:
                    face['projectionReasons'].append(f'{name}_profile_unavailable')
        if has_call:
            face['projectionReasons'].append('external_call_population_not_resolved')
        face['projectionReasons'] = sorted(set(face['projectionReasons']))
        face['projectionEligible'] = not face['projectionReasons']
    resources = [{'declarationIndex': d['index'], 'kind': 'material_library' if d['directive'] == 'mtllib' else 'material_name',
                  'arguments': d['arguments'], 'locator': d['locator'], 'state': 'needs_input',
                  'reason': 'Companion material definitions are not supplied/resolved; texture references cannot be inspected.'}
                 for d in declarations if d['directive'] in {'mtllib', 'usemtl'}]
    usable = sum(face['projectionEligible'] for face in faces)
    partial = bool(unsupported or resources or usable != len(faces) or not faces or
                   any(record['status'] != 'source_values' or record.get('reason') for stream in streams.values() for record in stream))
    return {'schemaVersion': 'obj-source-context/1', 'profile': 'utf8-literal-polygons/1', 'status': 'inspected_partial' if partial else 'inspected_local',
            'sourceSha256': _sha(raw), 'sourceBytes': len(raw), 'representation': 'context_mesh',
            'encoding': 'utf8_bom' if raw.startswith(b'\xef\xbb\xbf') else 'utf8',
            'locatorBasis': 'original-file-bytes-zero-based-end-exclusive; physical-lines-one-based',
            'vertices': vertices, 'textures': textures, 'normals': normals, 'faces': faces, 'declarations': declarations,
            'unsupported': unsupported, 'resources': resources,
            'geometryProjectionStatus': 'available' if usable and usable == len(faces) else 'partial' if usable else 'unavailable',
            'counts': {'vertices': len(vertices), 'textures': len(textures), 'normals': len(normals), 'faces': len(faces),
                       'faceReferences': total_references, 'eligiblePolygons': usable, 'declarations': len(declarations), 'unsupported': len(unsupported)},
            'qualification': {'axes': 'unknown', 'units': 'unknown', 'crs': 'unknown', 'heightReference': 'unknown',
                              'globalPlacement': 'unknown', 'topology': 'not_assessed', 'analyticalGeometry': False, 'measurements': False,
                              'propertyIdentity': False, 'registryAdmission': False, 'learningTruth': False,
                              'polygonOrder': 'source_order; no triangulation or winding conversion',
                              'indices': 'positive_absolute_final_file_population; negative_relative_source_order_population',
                              'missingComponents': 'absent; no specification defaults inserted',
                              'materialsAndTextures': 'declarations_only; companions_not_resolved'}}


def write_inspection(result, handle):
    total, digest = 0, hashlib.sha256()
    for fragment in json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(',', ':')).iterencode(result):
        block = fragment.encode('utf-8')
        total += len(block)
        if total > MAX_OUTPUT_BYTES:
            _fail('OUTPUT_LIMIT', 'Serialized context exceeds 16 MiB; no truncation is permitted.')
        handle.write(block)
        digest.update(block)
    return {'bytes': total, 'sha256': digest.hexdigest()}


def _worker(source, output, expected_sha):
    try:
        with open(source, 'rb') as handle:
            raw = handle.read(MAX_INPUT_BYTES + 1)
        if _sha(raw) != expected_sha:
            _fail('SOURCE_HASH', 'Worker snapshot differs from the locked original.')
        result = inspect_obj(raw)
        with open(output, 'xb') as handle:
            artifact = write_inspection(result, handle)
        print(json.dumps({'status': result['status'], 'sourceSha256': result['sourceSha256'], 'counts': result['counts'], 'artifact': artifact}))
        return 0
    except ObjError as error:
        print(json.dumps({'error': error.as_dict()}))
        return 2
