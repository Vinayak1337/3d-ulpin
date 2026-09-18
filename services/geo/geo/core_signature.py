"""Versioned tagged binary64 encoding, not RFC8785 or a generic JSON serializer."""
import hashlib
import struct
from .core_contract import assert_core_json, bundled_schema, fail


def canonical_core_text(value):
    assert_core_json(value)
    maximum = bundled_schema("snapshot-input")[0]["x-ulpin-snapshot-policy"]["maximumEncodingBytes"]
    pieces, size = [], 0

    def push(text):
        nonlocal size
        try:
            encoded = text.encode("utf-8", errors="strict")
        except UnicodeEncodeError:
            fail("SIGNATURE_UNICODE", "Unpaired surrogate is not a portable UTF-8 string")
        size += len(encoded)
        if size > maximum:
            fail("SIGNATURE_LIMIT", "Canonical input exceeds the bounded encoding profile")
        pieces.append(text)

    def string(text):
        try:
            length = len(text.encode("utf-8", errors="strict"))
        except UnicodeEncodeError:
            fail("SIGNATURE_UNICODE", "Unpaired surrogate is not a portable UTF-8 string")
        push(f"s{length}:{text}")

    def visit(item):
        if item is None:
            push("z")
        elif type(item) is bool:
            push("t" if item else "f")
        elif type(item) in (int, float):
            push("n" + struct.pack(">d", 0 if item == 0 else item).hex())
        elif type(item) is str:
            string(item)
        elif type(item) is list:
            push(f"a{len(item)}:")
            for child in item:
                visit(child)
        else:
            push(f"o{len(item)}:")
            for key in sorted(item):
                string(key)
                visit(item[key])

    visit(value)
    return "".join(pieces)


def core_input_digest(value):
    return hashlib.sha256(canonical_core_text(value).encode("utf-8")).hexdigest()
