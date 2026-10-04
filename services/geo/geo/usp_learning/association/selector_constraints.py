"""Opt-in, source-bounded byte-prefix masking; never repairs model output.

No model/tokenizer imports. Native decoding equivalence is checked only by the
separately authorized contained caller. Semantic acceptance still belongs to
selectors.project, not this controller.
"""
from __future__ import annotations

from array import array
from dataclasses import dataclass, replace
import codecs
import hashlib
import json
from pathlib import Path
import time

from .selectors import canonical, lex, SCHEMA_SHA, PROMPT_SHA
from .validation import require

VERSION = "association-selector-constraints/1"
EXECUTION_VERSION = "association-selector-constrained-execution/1"
FREEZE_VERSION = "association-selector-constrained-freeze/1"
TOKENIZER_PINS = {
    "tokenizer.json": "c0382117ea329cdf097041132f6d735924b697924d6f6fc3945713e96ce87539",
    "tokenizer_config.json": "5b5d4f65d0acd3b2d56a35b56d374a36cbc1c8fa5cf3b3febbbfabf22f359583",
}
POLICY = {
    "version": VERSION,
    "schemaSha256": SCHEMA_SHA, "systemPromptSha256": PROMPT_SHA,
    "language": "compact JSON; sorted object keys; fixed public schema enums; Unicode scalar decision codes, length1..120",
    "sourceChoices": "current source lexical positions only; lazy integer intervals, nonempty spans, exclusive ends",
    "citationCoverage": "literal/unit spans inside one own citation; distinct pointer triples per citation list",
    "states": "declared requires a non-null literal; unknown/absent/null/withheld require null literal and unit",
    "forcedElements": ["syntax/key order/schema limits", "source ranges", "literal/unit citation coverage and lengths",
                       "state/value compatibility", "at least two conflict citations",
                       "first no_canonical_targets abstention", "empty canonicalLinks"],
    "notEnforced": ["correct semantic role/literal/state/unit", "exact identifier/unit boundaries",
                    "duplicate quoted text at different positions", "conflict truth/coverage", "native attribute matching"],
    "transport": "pinned ByteLevel BPE bytes; incremental strict UTF-8/JSON escapes; all added tokens excluded except complete-response EOS151645",
    "selection": "Transformers prefix_allowed_tokens_fn additive negative-infinity mask; allowed logits unchanged",
    "bounds": {"outputBytes": 65536, "trieNodes": 1500000, "maskNodeVisits": 1500000,
               "maskSeconds": 5, "generatedTokens": 768, "batchSize": 1, "beams": 1},
    "qualification": "controller-enforced validity is not learned accuracy; unchanged whole-response semantic projection required",
}


def metadata():
    return {"policy": json.loads(canonical(POLICY)),
            "policySha256": hashlib.sha256(canonical(POLICY).encode()).hexdigest(),
            "tokenizerFilesSha256": dict(TOKENIZER_PINS)}


def checked_metadata(value):
    require(canonical(value) == canonical(metadata()), "selector_constraint_policy_drift")
    return value


def literal(text):
    return ("lit", text.encode("utf-8"))


def choices(values, action=None):
    return ("choice", tuple((canonical(value).encode(), ((action, value),) if action else ()) for value in values))


@dataclass(frozen=True, slots=True)
class State:
    ops: tuple
    citations: tuple = ()
    has_literal: bool = False
    value_state: str = ""
    byte_count: int = 0


def interval_prefix(prefix, intervals):
    """Is some bounded integer's decimal spelling prefixed by these digits?"""
    if not prefix or (len(prefix) > 1 and prefix[0] == "0"):
        return False
    value = int(prefix)
    for low, high in intervals:
        for extra in range(1 if prefix == "0" else max(0, len(str(high)) - len(prefix)) + 1):
            scale = 10 ** extra
            if max(low, value * scale) <= min(high, (value + 1) * scale - 1):
                return True
    return False


class Grammar:
    """Small persistent pushdown state. No span/triple/product enumeration."""

    def __init__(self, source, selector_schema):
        require(hashlib.sha256(canonical(selector_schema).encode()).hexdigest()
                == "bf61accbe3e5a48d2340b21283ac0fa359a3cd3f01fa8ce75ecf0da5e0852a6f",
                "selector_constraint_schema_drift")
        self.roles = tuple(selector_schema["$defs"]["claim"]["properties"]["role"]["enum"])
        self.states = tuple(selector_schema["$defs"]["claim"]["properties"]["state"]["enum"])
        require(self.roles == ("project", "building", "building_type", "floor", "drawing", "revision",
                               "source_identifier", "level", "area", "unit")
                and self.states == ("declared", "unknown", "absent", "null", "withheld", "conflicting"),
                "selector_constraint_contract_drift")
        self.source_sha256 = source.input_sha256
        fragments = source.example()["evidence"]
        self.tokens = tuple(lex(row["text"]) for row in fragments)
        require(1 <= len(self.tokens) <= 25 and all(len(row["text"]) <= 4096 for row in fragments),
                "selector_constraint_source_bound")
        self.lengths = tuple(len(row) for row in self.tokens)
        self.span_count = sum(n * (n + 1) // 2 for n in self.lengths)
        self.value_starts = {}
        for kind, limit in (("literal", 1024), ("unit", 80)):
            ranges = []
            for tokens in self.tokens:
                intervals = []
                for index, (_, start, end) in enumerate(tokens):
                    if end - start <= limit:
                        if intervals and intervals[-1][1] == index - 1:
                            intervals[-1] = (intervals[-1][0], index)
                        else:
                            intervals.append((index, index))
                ranges.append(tuple(intervals))
            self.value_starts[kind] = tuple(ranges)

    def initial(self):
        return State((literal('{"abstentions":[{"citations":[],"code":"no_canonical_targets"}'),
                      ("after_array", "abstentions", 1), literal(',"canonicalLinks":[],"claims":['),
                      ("array", "claims", 0, True), literal(',"conflicts":['),
                      ("array", "conflicts", 0, True), literal(',"version":"evidence-association-selectors/1"}')))

    def _intervals(self, state, kind, parts):
        # Value pointers may use any subspan of a selected citation, without
        # constraining which semantic field it represents.
        bounds = state.citations if kind != "citation" else tuple((i, 0, n) for i, n in enumerate(self.lengths) if n)
        if not parts:
            return tuple((f, f) for f, first, end in bounds if self._intervals(state, kind, (f,)))
        if len(parts) == 1:
            spans = [(first, end - 1) for f, first, end in bounds if f == parts[0]]
            if kind != "citation":
                spans = [(max(lo, a), min(hi, b)) for lo, hi in spans
                         for a, b in self.value_starts[kind][parts[0]] if max(lo, a) <= min(hi, b)]
            else:
                for start in {p[1] for p in state.citations if p[0] == parts[0]}:
                    used = sum(p[0] == parts[0] and p[1] == start for p in state.citations)
                    if used == self.lengths[parts[0]] - start:
                        spans = [(a, b) for lo, hi in spans for a, b in ((lo, min(hi, start - 1)), (max(lo, start + 1), hi)) if a <= b]
            return tuple(spans)
        fragment, first = parts
        spans = []
        for f, start, end in bounds:
            if f != fragment or not start <= first < end:
                continue
            if kind != "citation":
                limit = 1024 if kind == "literal" else 80
                # Binary search the exclusive end; do not enumerate subspans.
                low, high = first, end
                while low < high:
                    middle = (low + high + 1) // 2
                    if self.tokens[f][middle - 1][2] - self.tokens[f][first][1] <= limit:
                        low = middle
                    else:
                        high = middle - 1
                end = low
            if end > first:
                spans.append((first + 1, end))
        if kind == "citation":
            # Remove already emitted triples without constructing every span.
            for f, start, end in state.citations:
                if f == fragment and start == first:
                    spans = [(a, b) for lo, hi in spans for a, b in ((lo, min(hi, end - 1)), (max(lo, end + 1), hi)) if a <= b]
        return tuple(spans)

    def _normalize(self, state):
        while state.ops:
            op, *rest = state.ops
            tag = op[0]
            if tag == "set_state":
                state = replace(state, ops=tuple(rest), value_state=op[1])
            elif tag == "set_null":
                state = replace(state, ops=tuple(rest), has_literal=False)
            elif tag == "state":
                values = ("declared", "conflicting") if state.has_literal else ("unknown", "absent", "null", "withheld", "conflicting")
                state = replace(state, ops=(choices(values, "set_state"), *rest))
            elif tag == "value":
                kind = op[1]
                null_action = (("set_null",),) if kind == "literal" else ()
                options = [(b"null", null_action)]
                if (self._intervals(state, kind, ())
                        and (kind == "literal" or state.value_state not in ("unknown", "absent", "null", "withheld"))):
                    options.append((b"[", (("number", kind, (), ""),)))
                state = replace(state, ops=(("choice", tuple(options)), *rest))
            else:
                break
        return state

    def step(self, state, byte):
        """Return the new immutable state or None; never modifies a prefix."""
        state = self._normalize(state)
        if not state.ops or state.byte_count >= POLICY["bounds"]["outputBytes"]:
            return None
        op, *rest = state.ops
        rest = tuple(rest)
        tag = op[0]
        result = None
        if tag == "lit":
            if byte == op[1][0]:
                result = replace(state, ops=((("lit", op[1][1:]),) if len(op[1]) > 1 else ()) + rest)
        elif tag == "choice":
            matches = [(word[1:], then) for word, then in op[1] if word[0] == byte]
            if matches:
                complete = [then for word, then in matches if not word]
                require(not complete or len(matches) == len(complete) == 1, "selector_constraint_ambiguous_grammar")
                result = replace(state, ops=complete[0] + rest if complete else (("choice", tuple(matches)),) + rest)
        elif tag in ("array", "after_array"):
            group, count = op[1:3]
            maximum = 25 if group == "claims" else 12
            possible = self.span_count >= (2 if group == "conflicts" else 1) if group != "abstentions" else True
            if byte == 93 and (tag == "after_array" or op[3]):  # ]
                result = replace(state, ops=rest)
            elif tag == "after_array" and byte == 44 and count < maximum and possible:
                result = replace(state, ops=(("array", group, count, False),) + rest)
            elif tag == "array" and byte == 123 and count < maximum and possible:
                tail = (literal("}"), ("after_array", group, count + 1), *rest)
                if group == "claims":
                    body = (literal('"citations":['), ("citations", 1, True), literal(',"literal":'),
                            ("value", "literal"), literal(',"role":'), choices(self.roles), literal(',"state":'),
                            ("state",), literal(',"unit":'), ("value", "unit"))
                else:
                    body = (literal('"citations":['), ("citations", 2 if group == "conflicts" else 0, True),
                            literal(',"code":"'), ("string", 0, "text", b"", 0))
                result = replace(state, ops=body + tail, citations=(), has_literal=False, value_state="")
        elif tag in ("citations", "after_citations"):
            minimum = op[1]
            count = len(state.citations)
            if byte == 93 and count >= minimum and (tag == "after_citations" or op[2]):
                result = replace(state, ops=rest)
            elif tag == "after_citations" and byte == 44 and count < min(8, self.span_count):
                result = replace(state, ops=(("citations", minimum, False),) + rest)
            elif tag == "citations" and byte == 91 and count < min(8, self.span_count):
                result = replace(state, ops=(("number", "citation", (), ""), ("after_citations", minimum), *rest))
        elif tag == "number":
            kind, parts, prefix = op[1:]
            intervals = self._intervals(state, kind, parts)
            if 48 <= byte <= 57:
                prefix += chr(byte)
                if interval_prefix(prefix, intervals):
                    result = replace(state, ops=((tag, kind, parts, prefix),) + rest)
            elif prefix and byte == (93 if len(parts) == 2 else 44) and any(lo <= int(prefix) <= hi for lo, hi in intervals):
                parts += (int(prefix),)
                if len(parts) < 3:
                    result = replace(state, ops=((tag, kind, parts, ""),) + rest)
                else:
                    result = replace(state, ops=rest,
                                     citations=state.citations + (parts,) if kind == "citation" else state.citations,
                                     has_literal=True if kind == "literal" else state.has_literal)
        elif tag == "string":
            count, mode, buffer, high = op[1:]
            next_string = None
            if mode == "text":
                if byte == 34:
                    if count:
                        result = replace(state, ops=rest)
                elif count < 120:
                    if byte == 92:
                        next_string = (count, "escape", b"", 0)
                    elif 32 <= byte < 128:
                        next_string = (count + 1, "text", b"", 0)
                    elif byte >= 128:
                        next_string = self._utf8(count, bytes([byte]))
            elif mode == "utf8":
                next_string = self._utf8(count, buffer + bytes([byte]))
            elif mode == "escape":
                if byte in b'"\\/bfnrt':
                    next_string = (count + 1, "text", b"", 0)
                elif byte == 117:
                    next_string = (count, "hex", b"", 0)
            elif mode == "pair_slash" and byte == 92:
                next_string = (count, "pair_u", b"", high)
            elif mode == "pair_u" and byte == 117:
                next_string = (count, "hex", b"", high)
            elif mode == "hex" and byte in b"0123456789abcdefABCDEF":
                buffer += bytes([byte])
                lower = int(buffer, 16) * 16 ** (4 - len(buffer))
                upper = lower + 16 ** (4 - len(buffer)) - 1
                ranges = ((0xDC00, 0xDFFF),) if high else ((0, 0xDBFF), (0xE000, 0xFFFF))
                viable = any(max(lower, lo) <= min(upper, hi) for lo, hi in ranges)
                if not viable:
                    return None
                if len(buffer) < 4:
                    next_string = (count, mode, buffer, high)
                else:
                    value = int(buffer, 16)
                    if high and 0xDC00 <= value <= 0xDFFF:
                        next_string = (count + 1, "text", b"", 0)
                    elif not high and 0xD800 <= value <= 0xDBFF:
                        next_string = (count, "pair_slash", b"", value)
                    elif not high and not 0xDC00 <= value <= 0xDFFF:
                        next_string = (count + 1, "text", b"", 0)
            if next_string is not None:
                result = replace(state, ops=((tag, *next_string),) + rest)
        else:
            raise RuntimeError("unknown selector constraint grammar instruction")
        return None if result is None else self._normalize(replace(result, byte_count=state.byte_count + 1))

    @staticmethod
    def _utf8(count, pending):
        # CPython may defer rejection of ED A0 until byte three. Such a prefix
        # has no Unicode-scalar completion and must be masked at byte two.
        if len(pending) >= 2:
            low, high = {0xE0: (0xA0, 0xBF), 0xED: (0x80, 0x9F),
                         0xF0: (0x90, 0xBF), 0xF4: (0x80, 0x8F)}.get(pending[0], (0x80, 0xBF))
            if not low <= pending[1] <= high:
                return None
        try:
            value, consumed = codecs.utf_8_decode(pending, "strict", False)
        except UnicodeDecodeError:
            return None
        return (count + 1, "text", b"", 0) if value and consumed == len(pending) else (count, "utf8", pending, 0)

    def feed(self, state, data):
        for byte in data:
            state = self.step(state, byte)
            if state is None:
                break
        return state


class Vocabulary:
    """Compact shared byte trie from pinned JSON, without native tokenization."""
    eos_id = 151645

    def __init__(self, model_path):
        documents = {}
        for name, expected in TOKENIZER_PINS.items():
            raw = (Path(model_path) / name).read_bytes()
            require(hashlib.sha256(raw).hexdigest() == expected, "selector_constraint_tokenizer_pin_drift:" + name)
            documents[name] = json.loads(raw)
        data, config = documents["tokenizer.json"], documents["tokenizer_config.json"]
        self.decoder = data["decoder"]
        require(self.decoder["type"] == "ByteLevel" and data["model"]["type"] == "BPE"
                and not data["model"]["byte_fallback"] and config["clean_up_tokenization_spaces"] is False
                and config["eos_token"] == "<|im_end|>", "selector_constraint_unsupported_tokenizer")
        visible = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
        missing = [b for b in range(256) if b not in visible]
        inverse = dict(zip(map(chr, visible + list(range(256, 256 + len(missing)))), visible + missing))
        self.expected_vocab = dict(data["model"]["vocab"])
        by_id = [None] * len(self.expected_vocab)
        for token, index in self.expected_vocab.items():
            require(type(index) is int and 0 <= index < len(by_id) and by_id[index] is None,
                    "selector_constraint_vocab_id")
            require(token and all(c in inverse for c in token), "selector_constraint_unsupported_byte_token")
            by_id[index] = bytes(inverse[c] for c in token)
        require(all(by_id), "selector_constraint_vocab_gap")
        self.token_bytes = tuple(by_id)
        self.single_bytes = {b[0]: i for i, b in enumerate(by_id) if len(b) == 1}
        require(len(self.single_bytes) == 256, "selector_constraint_missing_byte_tokens")
        for added in data["added_tokens"]:
            self.expected_vocab[added["content"]] = added["id"]
        # Sorted insertion builds sibling lists without one Python dict per node.
        self.first, self.next, self.label, self.terminal = array('i', [-1]), array('i', [-1]), bytearray([0]), array('i', [-1])
        last_child = array('i', [-1])
        previous, path = b"", [0]
        for token, index in sorted((b, i) for i, b in enumerate(by_id)):
            shared = 0
            while shared < min(len(token), len(previous)) and token[shared] == previous[shared]:
                shared += 1
            path = path[:shared + 1]
            for byte in token[shared:]:
                node, parent = len(self.first), path[-1]
                require(node < POLICY["bounds"]["trieNodes"], "selector_constraint_trie_bound")
                self.first.append(-1); self.next.append(-1); self.label.append(byte); self.terminal.append(-1); last_child.append(-1)
                if last_child[parent] < 0:
                    self.first[parent] = node
                else:
                    self.next[last_child[parent]] = node
                last_child[parent] = node
                path.append(node)
            require(self.terminal[path[-1]] == -1, "selector_constraint_duplicate_token_bytes")
            self.terminal[path[-1]] = index
            previous = token

    def verify_runtime(self, tokenizer):
        """Run only inside an authorized model phase; PREP never calls native code."""
        require(tokenizer.is_fast and tokenizer.eos_token_id == self.eos_id
                and tokenizer.clean_up_tokenization_spaces is False
                and tokenizer.get_vocab() == self.expected_vocab, "selector_constraint_native_vocab_drift")
        decoder = json.loads(tokenizer.backend_tokenizer.decoder.__getstate__())
        require(decoder == self.decoder, "selector_constraint_native_decoder_drift")
        for data in (b'{"x":[10,25]}', 'éह😀'.encode(), b'\\uD83D\\uDE00', b'\xe2', b'\xe2\x82\xac'):
            ids = [self.single_bytes[b] for b in data]
            require(tokenizer.decode(ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)
                    == data.decode('utf-8', 'replace'), "selector_constraint_native_transport_mismatch")

    def allowed(self, grammar, state):
        if not state.ops:
            return [self.eos_id], 0
        started, visits, allowed = time.perf_counter(), 0, []
        pending = [(self.first[0], state)]
        while pending:
            node, parent_state = pending.pop()
            while node >= 0:
                visits += 1
                if visits % 2048 == 0:
                    require(visits <= POLICY["bounds"]["maskNodeVisits"]
                            and time.perf_counter() - started <= POLICY["bounds"]["maskSeconds"],
                            "selector_constraint_mask_bound")
                child_state = grammar.step(parent_state, self.label[node])
                if child_state is not None:
                    if self.terminal[node] >= 0:
                        allowed.append(self.terminal[node])
                    if self.first[node] >= 0:
                        pending.append((self.first[node], child_state))
                node = self.next[node]
        require(allowed, "selector_constraint_empty_allowed_set")
        return allowed, visits


class Controller:
    """Batch-one greedy callback compatible with PrefixConstrainedLogitsProcessor."""
    def __init__(self, vocabulary, source, schema, prompt_ids, *, grammar=None):
        self.vocabulary = vocabulary
        self.grammar = Grammar(source, schema) if grammar is None else grammar
        require(self.grammar.source_sha256 == source.input_sha256, "selector_constraint_grammar_source_drift")
        self.prompt_ids, self.generated = tuple(prompt_ids), ()
        self.state = self.grammar.initial()
        self.raw_bytes = bytearray()
        self.last_allowed = None
        self.calls = self.visits = 0
        self.mask_seconds = self.max_mask_seconds = 0.0
        self.eos = False

    def _advance(self, generated):
        generated = tuple(generated)
        require(len(generated) <= POLICY["bounds"]["generatedTokens"] and generated[:len(self.generated)] == self.generated,
                "selector_constraint_nonmonotonic_generated_prefix")
        if len(generated) == len(self.generated):
            return
        for index in generated[len(self.generated):]:
            require(not self.eos, "selector_constraint_tokens_after_eos")
            if index == self.vocabulary.eos_id:
                require(not self.state.ops, "selector_constraint_premature_eos")
                self.eos = True
            else:
                require(type(index) is int and 0 <= index < len(self.vocabulary.token_bytes), "selector_constraint_unsupported_token_id")
                data = self.vocabulary.token_bytes[index]
                state = self.grammar.feed(self.state, data)
                require(state is not None, "selector_constraint_illegal_generated_token")
                self.state = state
                self.raw_bytes.extend(data)
        self.generated, self.last_allowed = generated, None

    def __call__(self, batch_id, input_ids):
        require(batch_id == 0, "selector_constraint_batch_or_beam_unsupported")
        ids = tuple(input_ids.tolist())
        require(ids[:len(self.prompt_ids)] == self.prompt_ids, "selector_constraint_prompt_changed")
        self._advance(ids[len(self.prompt_ids):])
        require(not self.eos, "selector_constraint_callback_after_eos")
        if self.last_allowed is None:
            started = time.perf_counter()
            self.last_allowed, visits = self.vocabulary.allowed(self.grammar, self.state)
            elapsed = time.perf_counter() - started
            self.calls += 1; self.visits += visits; self.mask_seconds += elapsed
            self.max_mask_seconds = max(self.max_mask_seconds, elapsed)
        return self.last_allowed

    def finish(self, generated_ids, raw_text):
        self._advance(generated_ids)
        # UTF-8 may be incomplete at the external token cap. Preserve the real
        # tokenizer replacement output and mark incomplete; never close/repair it.
        expected = bytes(self.raw_bytes).decode('utf-8', 'replace')
        require(raw_text == expected, "selector_constraint_final_decode_mismatch")
        return {"policyVersion": getattr(self.grammar, "version", VERSION), "sourceInputSha256": self.grammar.source_sha256,
                "grammarComplete": not self.state.ops, "eosEmitted": self.eos,
                "generatedBytesSha256": hashlib.sha256(self.raw_bytes).hexdigest(),
                "maskCalls": self.calls, "trieNodeVisits": self.visits,
                "maskSeconds": self.mask_seconds, "maxMaskSeconds": self.max_mask_seconds,
                "repairApplied": False, "enforcedValidityIsLearnedAccuracy": False}


def checked_generation_config(config):
    require(getattr(config, "num_beams", 1) == 1 and getattr(config, "num_return_sequences", 1) == 1,
            "selector_constraint_batch_or_beam_unsupported")
    for name in ("forced_bos_token_id", "forced_eos_token_id", "forced_decoder_ids", "constraints", "force_words_ids"):
        require(getattr(config, name, None) is None, "selector_constraint_forced_generation_unsupported:" + name)
