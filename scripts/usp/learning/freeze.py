#!/usr/bin/env python3
"""Pin the source-only proof, family coverage and one configuration without running a model."""

import argparse
import json
from pathlib import Path

from geo.usp_learning.corpus import input_proof, load_examples
from geo.usp_learning.experiment import make_freeze
from geo.usp_learning.resources import write_json_once


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--output-proof", type=Path, required=True)
    parser.add_argument("--output-freeze", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args()
    if args.output_proof.exists() or args.output_freeze.exists():
        parser.error("proof/freeze artifacts already exist")
    corpus, examples = load_examples(args.corpus, args.originals_dir)
    write_json_once(args.output_proof, input_proof(args.corpus, examples))
    config = make_freeze(args.corpus, args.output_proof, corpus, examples,
                         Path(__file__).resolve().parents[3], args.device)
    write_json_once(args.output_freeze, config)
    print(json.dumps(config["coverage"], indent=2))


if __name__ == "__main__":
    main()
