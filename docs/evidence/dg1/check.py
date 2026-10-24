"""Check the presenter documentation against committed receipts; no services or originals are opened."""

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
GUIDE = ROOT / "docs/STUDIO_DEMO_GUIDE.md"
EVIDENCE = Path(__file__).resolve().parent


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def check_links(text: str) -> int:
    pattern = r'^\[([^\]]+)\]:\s+(\S+)(?:[ \t]+"([^"\n]+)"|\n[ \t]+"([^"\n]+)")?'
    definitions = {match[0]: match[1:] for match in re.findall(pattern, text, re.MULTILINE)}
    references = set(re.findall(r'(?<!!)\[([A-Za-z][A-Za-z0-9]*)\](?![:(])', text))
    assert references <= definitions.keys(), "Undefined evidence reference"
    inline = re.findall(r'\[[^\]]*\]\(([^\s)]+)', text)
    targets = [value[0] for value in definitions.values()] + inline
    for target in targets:
        assert not target.startswith(("http:", "https:")), "Expected branch-local links"
        path = GUIDE.parent / target.split("#", 1)[0]
        assert path.is_file(), f"Unresolved link: {target}"
    for target, same_line, next_line in definitions.values():
        fields = same_line or next_line
        if not fields or not target.endswith(".json"):
            continue
        receipt = read_json(GUIDE.parent / target)
        for field in fields.split("; "):
            value = receipt
            for part in field.split("."):
                value = value[part]
    return len(targets)


def changed_runbook_lines(base: str) -> set[int]:
    command = ["git", "diff", base, "--unified=0", "--", "docs/STUDIO_DEMO_GUIDE.md"]
    diff = subprocess.check_output(command, cwd=ROOT).decode("utf-8")
    changed = set()
    for start, count in re.findall(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", diff, re.MULTILINE):
        changed.update(range(int(start), int(start) + int(count or "1")))
    return changed


def leading_note_lines(lines: list[str]) -> int:
    """Lines of the blockquote added under the title at merge time; recorded ranges predate it."""
    end = 1
    if end < len(lines) and not lines[end].strip() and end + 1 < len(lines) and lines[end + 1].startswith(">"):
        end += 1
        while end < len(lines) and lines[end].startswith(">"):
            end += 1
    return end - 1


def check_corrections(result: dict, lines: list[str]) -> None:
    source = read_json(ROOT / result["source"])
    expected = source["runbookCorrections"]
    changed = changed_runbook_lines(result["baseCommit"])
    offset = leading_note_lines(lines)
    assert len(result["corrections"]) == len(expected) == 13
    for index, correction in enumerate(result["corrections"]):
        original = "".join(expected[index])
        assert correction["id"] == index + 1
        assert "".join(correction["correction"]) == original, f"Correction {index + 1} differs from receipt"
        excerpts = []
        for start, end in correction["runbookLines"]:
            start, end = start + offset, end + offset
            assert 1 <= start <= end <= len(lines)
            assert changed.intersection(range(start, end + 1)), f"Unchanged correction range: {start}-{end}"
            excerpts.extend(lines[start - 1:end])
        excerpt = " ".join(" ".join(excerpts).split())
        for phrase in correction["requiredWords"]:
            assert phrase in excerpt, f"Correction {index + 1} lacks: {phrase}"


def check_boundaries(text: str) -> None:
    required = [
        "Card step: last proved at REH9 on the served demo commit; REH12 will re-prove it on the next roll",
        "No card, quoted register row or verification resulted.",
        "LAZ full completion was not qualified.",
        "one confirmation takes 100.",
        "Do not retry.",
        "confirmed evidence",
    ]
    normalized = " ".join(text.split())
    for phrase in required:
        assert phrase in normalized, f"Missing boundary: {phrase}"
    for obsolete in ["351.9 s", "440 s", "44.6 s", "Read 211 of 211 batches"]:
        assert obsolete not in text, f"Superseded timing/completion retained: {obsolete}"


def check_scope_and_secrets(base: str) -> None:
    command = ["git", "diff", base, "--name-only"]
    paths = subprocess.check_output(command, cwd=ROOT, text=True).splitlines()
    for path in paths:
        assert path == "docs/STUDIO_DEMO_GUIDE.md" or path.startswith("docs/evidence/dg1/"), path
    diff = subprocess.check_output(["git", "diff", base, "--"], cwd=ROOT).decode("utf-8")
    added = "\n".join(line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++"))
    patterns = [
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
        r"\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_\-]{20,}",
        r"(?i)(?:api[_-]?key|password|secret)\s*[:=]\s*[\"'][^\"'\s]{16,}",
    ]
    assert not any(re.search(pattern, added) for pattern in patterns), "Possible secret in added text"


def main() -> None:
    result = read_json(EVIDENCE / "result.json")
    text = GUIDE.read_text(encoding="utf-8")
    links = check_links(text)
    check_corrections(result, text.splitlines())
    check_boundaries(text)
    check_scope_and_secrets(result["baseCommit"])
    print(f"PASS: {links} local links and receipt fields; 13 corrections; boundaries; scope/secret scan")
    print("Documentation check only; no runtime, provider, credential or original access.")


if __name__ == "__main__":
    main()
