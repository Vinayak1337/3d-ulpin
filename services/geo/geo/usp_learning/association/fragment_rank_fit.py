"""Rank loss and complete-parent accumulation inside the shared adapter lifecycle.

No loader, optimizer factory, native import, execution authority or reload here.
"""
from __future__ import annotations

import math

from . import fragment_rank as rank
from .fragment_rank_runtime import label_boundary, analytic_gradient
from .reclamation import release_unused_cache
from .validation import require


def encode_training(tokenizer, rows, representation, preserve_failure, *, objective=None):
    encoded, lengths = [], []
    try:
        require([r["parentIndex"] for r in rows] == list(range(10)), "rank_train_parent_order")
        for row in rows:
            representation.validate_row(row)
            candidates, proofs = [], []
            for candidate in row["candidates"]:
                pair = candidate["pair"]
                prompt = tokenizer.apply_chat_template(representation.messages(candidate), tokenize=False, add_generation_prompt=True)
                ids, boundary = label_boundary(tokenizer, prompt)
                require(len(ids) <= 4096, "rank_train_prompt_exceeds_4096_no_truncation")
                record = {"candidateIndex": pair["candidateIndex"], "focusCandidateId": pair["focusCandidateId"],
                    "scoringInputSha256": pair["scoringInputSha256"], "pairSha256": rank.codec.canonical_sha(pair),
                    **boundary}
                if objective is not None:
                    from . import fragment_rank_balance as balance
                    record.update(balance.weight_fields(pair["label"], pair["weight"], objective))
                candidates.append({"record": record, "inputIds": ids, "label": pair["label"], "weight": pair["weight"]})
                proofs.append(record)
            parent = {"exampleId": row["exampleId"], "parentIndex": row["parentIndex"],
                "parentLineageSha256": row["parentLineageSha256"], "candidates": candidates}
            if objective is not None:
                parent.update(balance.fields(objective))
            encoded.append({"parent": parent, "sha256": rank.codec.canonical_sha(parent)})
            lengths.append({"exampleId": row["exampleId"], "candidateCount": len(candidates), "focuses": proofs,
                "combinedTokens": max(len(c["inputIds"]) for c in candidates), "promptOnly": True,
                "parentEncodingSha256": encoded[-1]["sha256"]})
        require(sum(len(p["parent"]["candidates"]) for p in encoded) == 57, "rank_train_57_prompts_required")
    except Exception as error:
        preserve_failure({"lengths": lengths, "failedParentIndex": len(encoded), "error": str(error),
            "labelBoundaryVerified": False, "truncation": False, "excludedRows": [], "promptOnly": True})
        raise
    return encoded, lengths


def checked_parent(parent, expected_sha, *, objective=None):
    require(rank.codec.canonical_sha(parent) == expected_sha, "rank_encoded_parent_drift")
    if objective is not None:
        from . import fragment_rank_balance as balance
        require(all(rank.codec.canonical_sha(parent.get(k)) == rank.codec.canonical_sha(v) for k, v in balance.fields(objective).items()), "balanced_encoded_parent_objective")
    else:
        require("objective" not in parent and "objectiveSha256" not in parent, "balanced_parent_requires_authority")
    candidates = parent["candidates"]
    require(type(candidates) is list and 1 <= len(candidates) <= 7, "rank_complete_parent_required")
    for index, candidate in enumerate(candidates):
        ids, record = candidate["inputIds"], candidate["record"]
        require(record["candidateIndex"] == index and record["focusCandidateId"] == f"c{index}", "rank_candidate_order_drift")
        require(type(candidate["label"]) is int and candidate["label"] in (0, 1)
                and candidate["weight"] == {"numerator": 1, "denominator": 10 * len(candidates)}, "rank_label_or_weight_drift")
        require(type(ids) is list and 0 < len(ids) <= 4096 and all(type(i) is int and i >= 0 for i in ids)
                and record["inputTokens"] == len(ids) and record["lastPromptPosition"] == len(ids) - 1
                and record["prefixIdsSha256"] == rank.codec.canonical_sha(ids)
                and record["completePrefixAndSingleTokenVerified"] is True, "rank_complete_prompt_drift")
        if objective is not None:
            require(all(rank.codec.canonical_sha(record.get(k)) == rank.codec.canonical_sha(v)
                        for k, v in balance.weight_fields(candidate["label"], candidate["weight"], objective).items()), "balanced_encoded_weight_drift")
        else:
            require("objectiveSha256" not in record, "balanced_focus_requires_authority")
        labels = record["labelIds"]
        require(set(labels) == {"0", "1"} and labels["0"] != labels["1"]
                and all(type(i) is int and i >= 0 for i in labels.values()), "rank_label_ids_drift")
    return candidates


def weighted_nll(logits, label_ids, label, weight, torch, *, objective=None):
    """Select two native head logits from the final prompt position, then cast."""
    require(len(logits.shape) == 3 and tuple(logits.shape[:2]) == (1, 1), "rank_training_last_position_shape")
    require(set(label_ids) == {"0", "1"} and label_ids["0"] != label_ids["1"]
            and all(type(i) is int and 0 <= i < logits.shape[2] for i in label_ids.values()), "rank_training_label_indices")
    require(type(label) is int and label in (0, 1) and type(weight) is dict and set(weight) == {"numerator", "denominator"}
            and type(weight["numerator"]) is int and weight["numerator"] == 1
            and type(weight["denominator"]) is int and weight["denominator"] in (10, 20, 30, 40, 50, 60, 70), "rank_training_weight_or_label")
    pair = torch.stack([logits[0, 0, label_ids[text]].to(dtype=torch.float32) for text in ("0", "1")])
    require(bool(torch.isfinite(pair).all()), "rank_nonfinite_label_logits")
    # log_softmax subtracts the maximum before logsumexp, including equal large logits.
    loss = -torch.nn.functional.log_softmax(pair, dim=0)[label] * (weight["numerator"] / weight["denominator"])
    if objective is not None:
        from . import fragment_rank_balance as balance
        balance.effective_weight(label, weight, objective)
        multiplier = balance.record()["classMultipliers"][str(label)]
        loss = loss * (multiplier["numerator"] / multiplier["denominator"])
    require(loss.dtype == torch.float32 and bool(torch.isfinite(loss)), "rank_nonfinite_weighted_loss")
    return loss


def accumulate_parent(parent, expected_sha, contribution, complete, *, objective=None):
    """No update until every bound candidate has contributed exactly once.

    contribution owns one forward/backward graph and returns only a scalar.
    complete owns the shared unscale/check/clip/step. Neither runs on a bad vector.
    """
    candidates = checked_parent(parent, expected_sha, objective=objective)
    losses = []
    for candidate in candidates:
        losses.append(rank.finite(contribution(candidate)))
    total = rank.finite(math.fsum(losses))
    complete(total)
    return total


def train_parent(encoded, *, model, decoder, head, torch, scaler, attention, phases, gpu_check, context, complete, objective=None):
    """Sequential graphs, unchanged accumulated adapter gradients between focuses."""
    def contribution(candidate):
        record = candidate["record"]
        facts = {**context, "candidateIndex": record["candidateIndex"], "focusCandidateId": record["focusCandidateId"]}
        if objective is not None:
            from . import fragment_rank_balance as balance
            facts.update(balance.weight_fields(candidate["label"], candidate["weight"], objective))
        attention.begin(facts, len(candidate["inputIds"]))
        ids = torch.tensor([candidate["inputIds"]], dtype=torch.long, device="cuda")
        phases.sample("before_decoder", torch, **facts, promptTokens=ids.shape[1])
        with torch.autocast("cuda", dtype=torch.float16):
            with model._enable_peft_forward_hooks(use_cache=False):
                hidden = decoder(input_ids=ids, attention_mask=torch.ones_like(ids), use_cache=False).last_hidden_state
            phases.sample("after_decoder", torch, **facts, attentionBlocks=attention.snapshot("decoder"))
            logits = head(hidden[:, -1:, :])
            loss = weighted_nll(logits, record["labelIds"], candidate["label"], candidate["weight"], torch, objective=objective)
        numeric = float(loss.detach())
        phases.sample("after_loss_before_backward", torch, **facts, weightedCandidateNll=numeric, headTokens=1)
        gpu_check()
        phases.sample("before_backward_reclamation", torch, **facts)
        reclaimed = release_unused_cache(torch)
        phases.sample("after_backward_reclamation", torch, **facts, **reclaimed)
        scaler.scale(loss).backward()
        phases.sample("after_backward", torch, **facts, weightedCandidateNll=numeric, attentionBlocks=attention.snapshot("backward"))
        del ids, hidden, logits, loss
        reclaimed = release_unused_cache(torch)
        phases.sample("after_candidate_reclamation", torch, **facts, accumulatedGradientsRetained=True, **reclaimed)
        gpu_check()
        return numeric

    return accumulate_parent(encoded["parent"], encoded["sha256"], contribution, complete, objective=objective)


def epoch_sums(losses, plan):
    require(len(losses) == plan["plannedUpdates"], "rank_epoch_loss_count")
    values = [rank.finite(loss) for loss in losses]
    count = plan["teacherExamples"]
    return [math.fsum(values[i:i + count]) for i in range(0, len(values), count)]


def run_equivalence(torch, output_dir, write, phases, *, objective=None):
    """Future native gate at the actual NLL and parent accumulator boundary.

    Four synthetic candidates share two trainable logits; independent CPU math
    gives the sum of weighted losses/gradients. No model/data is used here.
    """
    from .fragment_rank_adapter import LOSS_POLICY
    if objective is not None:
        from . import fragment_rank_balance as balance
        balance.checked(objective)
        LOSS_POLICY = balance.loss_policy(LOSS_POLICY)
    factor = lambda label: 1.0 if objective is None else balance.record()["classMultipliers"][str(label)]["numerator"] / balance.record()["classMultipliers"][str(label)]["denominator"]
    cases = [(2.0, -3.0, 0), (2.0, -3.0, 1), (0.0, 0.0, 1), (-1000.0, 1000.0, 0)]
    reference_loss = math.fsum(rank.binary_loss(a, b, label) / 40 * factor(label) for a, b, label in cases)
    reference_gradient = [math.fsum(analytic_gradient(a, b, label)[i] / 40 * factor(label) for a, b, label in cases) for i in (0, 1)]
    parent = {"candidates": [{"inputIds": [8, 9], "label": label, "weight": {"numerator": 1, "denominator": 40},
        "record": {"candidateIndex": i, "focusCandidateId": f"c{i}", "inputTokens": 2, "lastPromptPosition": 1,
            "prefixIdsSha256": rank.codec.canonical_sha([8, 9]), "completePrefixAndSingleTokenVerified": True,
            "labelIds": {"0": 2, "1": 0}}} for i, (_, _, label) in enumerate(cases)]}
    if objective is not None:
        parent.update(balance.fields(objective))
        for candidate in parent["candidates"]:
            candidate["record"].update(balance.weight_fields(candidate["label"], candidate["weight"], objective))
    records = []
    try:
        for device, native_dtype in ((d, t) for d in ("cpu", "cuda") for t in (torch.float32, torch.float16)):
            theta = torch.tensor([0.0, 0.0], dtype=torch.float32, device=device, requires_grad=True)
            completions = []

            def contribution(candidate):
                a, b, _ = cases[candidate["record"]["candidateIndex"]]
                logits = torch.stack([theta[1] + b, theta[0] * 0 + 13, theta[0] + a]).reshape(1, 1, 3).to(dtype=native_dtype)
                loss = weighted_nll(logits, candidate["record"]["labelIds"], candidate["label"], candidate["weight"], torch, objective=objective)
                numeric = float(loss.detach())
                (loss * 128).backward()
                return numeric

            total = accumulate_parent(parent, rank.codec.canonical_sha(parent), contribution, completions.append, objective=objective)
            gradient = (theta.grad / 128).detach().cpu().tolist()
            require(len(completions) == 1 and completions[0] == total, "rank_proof_parent_completion_drift")
            require(math.isclose(total, reference_loss, abs_tol=1e-6, rel_tol=1e-6)
                    and all(math.isclose(a, b, abs_tol=1e-4 if native_dtype == torch.float16 else 1e-6,
                                         rel_tol=1e-3 if native_dtype == torch.float16 else 1e-6)
                            for a, b in zip(gradient, reference_gradient, strict=True)),
                    "rank_weighted_parent_loss_or_gradient_mismatch")
            records.append({"device": device, "loss": total, "gradient": gradient, "contributions": 4, "completions": 1,
                "gradientScale": 128, "lossDtype": "float32", "nativeLogitsDtype": str(native_dtype)})
            del theta
        result = {"passed": True, "syntheticOnly": True, "actualLossAndAccumulationHelpers": True,
            "lossImplementation": LOSS_POLICY, "referenceLoss": reference_loss, "referenceGradient": reference_gradient, "records": records,
            **({} if objective is None else balance.fields(objective))}
    except Exception as error:
        write(output_dir / "loss-equivalence.json", {"passed": False, "records": records, "error": str(error), "lossImplementation": LOSS_POLICY})
        raise
    write(output_dir / "loss-equivalence.json", result)
    phases.sample("rank_loss_equivalence_passed", torch)
    return result
