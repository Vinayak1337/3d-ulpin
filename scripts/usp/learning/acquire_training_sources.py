#!/usr/bin/env python3
"""Retain one bounded public source response and its acquisition receipt; never overwrite."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path


def acquire(directory: Path, name: str, url: str, cap: int = 4 * 1024**2) -> dict:
    if name in ("", ".", "..") or Path(name).name != name or not url.startswith("https://"):
        raise ValueError("use a filename and an explicit public HTTPS source URL")
    if not 0 < cap <= 4 * 1024**2:
        raise ValueError("acquisition cap must be between one byte and four MiB")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    receipt_path = directory / (name + ".receipt.json")
    if path.exists() or receipt_path.exists():
        raise ValueError(f"retained response already exists: {name}")
    receipt = {"file": name, "url": url,
               "acquiredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "maximumBytes": cap}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "BhuAayam official source schema research"})
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            receipt.update(status=response.status, finalUrl=response.url,
                           contentType=response.headers.get("Content-Type"))
            body = response.read(cap + 1)
        if len(body) > cap:
            raise ValueError("response exceeds acquisition byte cap; no truncated original retained")
        with path.open("xb") as stream:
            stream.write(body)
        receipt.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
    except Exception as error:
        receipt["error"] = str(error)
    with receipt_path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(receipt, stream, indent=2)
        stream.write("\n")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    receipt = acquire(args.output_dir, args.name, args.url)
    print(json.dumps(receipt))
    if "error" in receipt or receipt.get("status") != 200:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
