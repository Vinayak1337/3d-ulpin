"""Fixed train-only objective math. No native imports, loader or execution authority."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from fractions import Fraction
import hashlib
import json

from .validation import require

_RECORD = {'classMultipliers': {'0': {'denominator': 274, 'numerator': 175}, '1': {'denominator': 76, 'numerator': 175}}, 'labels': '0=not directly supported;1=directly supported; provisional supervision unchanged', 'negativePairs': 45, 'normalization': 'Fixed global per-class mass over frozen57 pairs; no per-parent renormalization, sampling or dynamic batch normalization.', 'originalCandidateWeight': '1/(10*candidateCount)', 'originalNegativeMass': {'denominator': 175, 'numerator': 137}, 'originalPositiveMass': {'denominator': 175, 'numerator': 38}, 'pairs': 57, 'parentTotalsEqual': False, 'parents': 10, 'positivePairs': 12, 'promptSha256': '39ced4c36b37c0d67d3f68c95e10acdd8791c7e745d2139717aa050392cea6b5', 'publicationSha256': 'edffc5d0f047e065f0c1d32f50bc43592206ee9dca224000549f99622cd7cc82', 'selectionPolicySha256': 'ab32fe7cb76e34aca57dbc799b9664c8a05f26aae1eaa13dffdc1e19ae0cb5e2', 'targetClassMass': {'0': {'denominator': 2, 'numerator': 1}, '1': {'denominator': 2, 'numerator': 1}}, 'totalMass': {'denominator': 1, 'numerator': 1}, 'trainingDataSha256': '6dc7c52195c9d19683654c6593dd83b08eefc39327803510fdcaca824df529cd', 'version': 'association-fragment-rank-balanced-objective/1', 'weightDerivationUsesDevelopment': False}
OBJECTIVE_SHA256 = "d4ccb3dd75ec5e47d08f9ccb9d9ab5e043ac177147ec098e5e7aa96226531702"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def record():
    return copy.deepcopy(_RECORD)


@dataclass(frozen=True)
class Objective:
    sha256: str


def admit(value, digest):
    require(type(value) is dict and canonical(value) == canonical(_RECORD)
            and type(digest) is str and digest == OBJECTIVE_SHA256
            and hashlib.sha256(canonical(value)).hexdigest() == digest, "balanced_objective_authority")
    return Objective(digest)


def checked(objective):
    require(type(objective) is Objective and objective.sha256 == OBJECTIVE_SHA256, "balanced_objective_type")
    return objective


def fields(objective):
    checked(objective)
    return {"objective": record(), "objectiveSha256": OBJECTIVE_SHA256}


def effective_weight(label, original, objective):
    checked(objective)
    require(type(label) is int and label in (0, 1) and type(original) is dict
            and set(original) == {"numerator", "denominator"} and type(original["numerator"]) is int
            and original["numerator"] == 1 and type(original["denominator"]) is int
            and original["denominator"] in (10, 20, 30, 40, 50, 60, 70), "balanced_original_weight")
    m = _RECORD["classMultipliers"][str(label)]
    weight = Fraction(original["numerator"], original["denominator"]) * Fraction(m["numerator"], m["denominator"])
    return {"numerator": weight.numerator, "denominator": weight.denominator}


def weight_fields(label, original, objective):
    return {"originalWeight": copy.deepcopy(original), "effectiveWeight": effective_weight(label, original, objective),
            "classMultiplier": copy.deepcopy(_RECORD["classMultipliers"][str(label)]), "objectiveSha256": checked(objective).sha256}


def mass_summary(pairs, objective):
    checked(objective)
    require(type(pairs) is list and len(pairs) == 57, "balanced_57_pairs_required")
    original = {0: Fraction(0), 1: Fraction(0)}; effective = dict(original); parents = {}; families = set(); counts = {0: 0, 1: 0}
    for pair in pairs:
        label = pair["label"]; weight = pair["weight"]
        w = effective_weight(label, weight, objective)
        require(pair["targetText"] == str(label) and pair["split"] == "train" and pair["reviewState"] == "needs_independent_review"
                and pair["sarvamDerived"] is False and type(pair["candidateIndex"]) is int
                and pair["focusCandidateId"] == "c" + str(pair["candidateIndex"]), "balanced_pair_identity")
        counts[label] += 1; original[label] += Fraction(**weight); effective[label] += Fraction(**w)
        parents.setdefault(pair["parentExampleId"], []).append(pair); families.add(pair["familyId"])
    require(counts == {0: 45, 1: 12} and original == {0: Fraction(137, 175), 1: Fraction(38, 175)}
            and effective == {0: Fraction(1, 2), 1: Fraction(1, 2)} and len(parents) == 10 and len(families) == 2, "balanced_class_mass")
    totals = {}
    for name, rows in parents.items():
        require([r["candidateIndex"] for r in rows] == list(range(len(rows)))
                and all(r["weight"] == {"numerator": 1, "denominator": 10 * len(rows)} for r in rows), "balanced_parent_identity")
        total = sum((Fraction(**effective_weight(r["label"], r["weight"], objective)) for r in rows), Fraction(0))
        totals[name] = {"numerator": total.numerator, "denominator": total.denominator}
    return {"originalClassMass": {"0": copy.deepcopy(_RECORD["originalNegativeMass"]), "1": copy.deepcopy(_RECORD["originalPositiveMass"])},
            "effectiveClassMass": copy.deepcopy(_RECORD["targetClassMass"]), "totalMass": {"numerator": 1, "denominator": 1},
            "parentTotalsEqual": False, "effectiveParentMass": totals}


def loss_policy(original):
    return {**copy.deepcopy(original), "version": "association-fragment-rank-balanced-weighted-nll/1",
            "weight": "published original rational weight times fixed class multiplier, applied once before backward; no parent renormalization",
            **fields(admit(record(), OBJECTIVE_SHA256)), "proof": {**copy.deepcopy(original["proof"]),
                "version": "association-fragment-rank-balanced-loss-equivalence/1", "fixedClassMultiplierBeforeBackward": True}}
