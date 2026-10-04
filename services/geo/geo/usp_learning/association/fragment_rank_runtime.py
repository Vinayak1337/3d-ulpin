"""Rank helpers for the admitted existing loader; no imports or model loader here.

CPU doubles exercise these interfaces. Native claims require a separate frozen
baseline inside the existing containment and resource boundary.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import time

from . import fragment_rank as rank
from .selector_constraints import TOKENIZER_PINS
from .validation import require

codec = rank.codec


def label_boundary(tokenizer, prompt):
    """Prove both continuations at this actual rendered prompt, without repair."""
    ids = tokenizer.encode(prompt, add_special_tokens=False)
    require(type(ids) is list and ids and all(type(i) is int and i >= 0 for i in ids), "rank_prompt_ids_required")
    decode = lambda sequence: tokenizer.decode(sequence, skip_special_tokens=False, clean_up_tokenization_spaces=False)
    prefix = decode(ids)
    require(prefix.encode("utf-8") == prompt.encode("utf-8"), "rank_prompt_decoder_drift")
    labels = {}
    for label in ("0", "1"):
        continued = tokenizer.encode(prompt + label, add_special_tokens=False)
        require(type(continued) is list and len(continued) == len(ids) + 1 and continued[:-1] == ids,
                "rank_label_not_single_prefix_continuation")
        token = continued[-1]
        require(type(token) is int and token >= 0 and token not in tokenizer.all_special_ids
                and decode([token]).encode("utf-8") == label.encode("ascii")
                and decode(continued).encode("utf-8") == prefix.encode("utf-8") + label.encode("ascii"),
                "rank_label_decoder_bytes_drift")
        labels[label] = token
    require(labels["0"] != labels["1"], "rank_distinct_label_tokens_required")
    return ids, {"labelIds": labels, "inputTokens": len(ids), "lastPromptPosition": len(ids) - 1,
        "prefixIdsSha256": codec.canonical_sha(ids), "prefixUtf8Sha256": hashlib.sha256(prefix.encode()).hexdigest(),
        "continuationBytesHex": {"0": "30", "1": "31"}, "completePrefixAndSingleTokenVerified": True}


def prepare(tokenizer, model_path, contexts, schema, contract, family, settings, preserve_preflight):
    pins = {name: hashlib.sha256((Path(model_path) / name).read_bytes()).hexdigest() for name in TOKENIZER_PINS}
    require(pins == TOKENIZER_PINS, "rank_tokenizer_file_drift")
    require(len(contexts) == 2 and [len(c.snapshot()["candidates"]) for c in contexts] == [4, 3], "rank_seven_focuses_required")
    prepared, proofs = [], []
    for example_index, context in enumerate(contexts):
        snapshot = context.snapshot()
        for candidate_index, candidate in enumerate(snapshot["candidates"]):
            item = rank.scoring_input(snapshot, candidate["id"], schema, contract, family, allowed_splits=("development",))
            prompt = tokenizer.apply_chat_template(item.messages(), tokenize=False, add_generation_prompt=True)
            try:
                ids, proof = label_boundary(tokenizer, prompt)
                require(len(ids) <= settings["maxInputTokens"], "rank_input_bound_no_truncation")
            except Exception as error:
                preserve_preflight({"version": "association-fragment-rank-preflight/1", "representation": rank.metadata(),
                    "tokenizerFilesSha256": pins, "focuses": proofs, "nativeLabelBoundaryVerified": False,
                    "failedExampleId": snapshot["exampleId"], "failedCandidateId": candidate["id"],
                    "failedScoringInputSha256": item.sha256, "failedPromptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                    "error": str(error), "truncation": False, "teacherTargetsInPrompt": False})
                raise
            record = {"exampleId": snapshot["exampleId"], "exampleIndex": example_index,
                "candidateId": candidate["id"], "candidateIndex": candidate_index,
                "candidateSetSha256": context.input_sha256, "scoringInputSha256": item.sha256,
                "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(), "promptUtf8Bytes": len(prompt.encode()),
                **proof}
            prepared.append({"prompt": prompt, "inputIds": ids, "record": record})
            proofs.append(record)
    preserve_preflight({"version": "association-fragment-rank-preflight/1", "representation": rank.metadata(),
        "tokenizerFilesSha256": pins, "focuses": proofs, "focusCount": len(proofs),
        "truncation": False, "teacherTargetsInPrompt": False, "nativeLabelBoundaryVerified": True})
    return prepared


def label_logits(logits, label_ids, torch, vocab_size):
    require(tuple(logits.shape) == (1, 1, vocab_size), "rank_last_position_logits_shape")
    require(set(label_ids) == {"0", "1"} and label_ids["0"] != label_ids["1"]
            and all(type(i) is int and 0 <= i < vocab_size for i in label_ids.values()), "rank_label_logit_index")
    native = [logits[0, 0, label_ids[label]] for label in ("0", "1")]
    zero, one = [value.to(dtype=torch.float32) for value in native]
    values = {"nativeLogit0": rank.finite(native[0].item()), "nativeLogit1": rank.finite(native[1].item()),
        "logit0Float32": rank.finite(zero.item()), "logit1Float32": rank.finite(one.item()),
        "margin": rank.finite((one - zero).item())}
    return values


def score_focus(model, tokenizer, item, torch, gpu_check, *, reload_session=None):
    encoded = tokenizer(item["prompt"], return_tensors="pt", add_special_tokens=False, truncation=False)
    require(set(encoded) <= {"input_ids", "attention_mask"} and "input_ids" in encoded
            and tuple(encoded["input_ids"].shape) == (1, len(item["inputIds"]))
            and encoded["input_ids"][0].tolist() == item["inputIds"], "rank_forward_prompt_ids_drift")
    if "attention_mask" in encoded:
        require(tuple(encoded["attention_mask"].shape) == (1, len(item["inputIds"]))
                and encoded["attention_mask"][0].tolist() == [1] * len(item["inputIds"]), "rank_forward_mask_drift")
    gpu_check()
    encoded = {key: value.to("cuda") for key, value in encoded.items()}
    torch.cuda.synchronize()
    before = time.perf_counter()
    with torch.inference_mode():
        output = model(**encoded, logits_to_keep=1, use_cache=False, return_dict=True)
        values = label_logits(output.logits, item["record"]["labelIds"], torch, model.config.vocab_size)
    torch.cuda.synchronize()
    seconds = time.perf_counter() - before
    record = {**item["record"], **values, "scoreSeconds": seconds, "logitsToKeep": 1,
              "logitsShape": list(output.logits.shape), "nativeLogitsDtype": str(output.logits.dtype),
              "marginDtype": "float32", "scoreOrigin": "original_base_last_prompt_position"}
    if reload_session is not None:
        require(reload_session.model is model and reload_session.proof["passed"] is True, "rank_reload_native_proof_required")
        record.update(scoreOrigin="accepted_rank_adapter_last_prompt_position", adapterApplied=True,
            acceptedFitSha256=reload_session.proof["acceptedFitSha256"],
            adapterFilesSha256=reload_session.proof["adapterFilesSha256"],
            trainingSourceCommit=reload_session.proof["trainingSourceCommit"], fitPerformedInThisProcess=False)
    del output, encoded
    gpu_check()
    return record


def project_records(records, prepared, contexts, schema, contract, family):
    """Require both complete ordered vectors before returning any projection."""
    require(len(records) == len(prepared) == 7 and len(contexts) == 2, "rank_complete_seven_scores_required")
    for record, item in zip(records, prepared, strict=True):
        require(all(record.get(key) == value for key, value in item["record"].items()), "rank_raw_focus_binding_drift")
        for name in ("nativeLogit0", "nativeLogit1", "logit0Float32", "logit1Float32", "margin", "scoreSeconds"):
            rank.finite(record[name])
    results, vectors = [], []
    for index, context in enumerate(contexts):
        vector = {"version": rank.SCORE_VERSION, "policySha256": codec.canonical_sha(rank.POLICY),
            "candidateSetSha256": context.input_sha256,
            "scores": [{"candidateId": row["candidateId"], "margin": row["margin"]}
                       for row in records if row["exampleIndex"] == index]}
        projected = rank.project_scores(vector, context.snapshot(), schema, contract, family, allowed_splits=("development",))
        vectors.append(vector)
        results.append({"exampleId": context.snapshot()["exampleId"], **projected["projection"],
            "selection": projected["selection"], "scoreVectorSha256": codec.canonical_sha(vector)})
    return vectors, results


def analytic_gradient(zero, one, label):
    margin = rank.finite(one - zero)
    small = math.exp(-abs(margin))
    probability = 1 / (1 + small) if margin >= 0 else small / (1 + small)
    gradient = probability - label
    return [-gradient, gradient]


def technical_loss_proof(torch):
    """Isolated synthetic logits only: no model parameter, optimizer or target data."""
    pairs = [(2.0, -3.0, 0), (2.0, -3.0, 1), (0.0, 0.0, 0), (0.0, 0.0, 1),
             (-1000.0, 1000.0, 0), (-1000.0, 1000.0, 1), (1000.0, -1000.0, 0), (1000.0, -1000.0, 1)]
    parents = [[pairs[(parent + child) % len(pairs)] for child in range(parent % 5 + 1)] for parent in range(10)]
    reports = []
    for device, dtype, tolerance in (("cpu", torch.float64, 1e-10), ("cuda", torch.float32, 1e-6)):
        with torch.enable_grad():
            flat = [pair for parent in parents for pair in parent]
            logits = torch.tensor([[a, b] for a, b, _ in flat], dtype=dtype, device=device, requires_grad=True)
            labels = torch.tensor([label for _, _, label in flat], dtype=torch.long, device=device)
            losses = -torch.nn.functional.log_softmax(logits, dim=-1).gather(1, labels[:, None]).squeeze(1)
            expected = [rank.binary_loss(*pair) for pair in flat]
            actual = losses.detach().cpu().tolist()
            require(all(math.isclose(rank.finite(a), e, rel_tol=tolerance, abs_tol=tolerance)
                        for a, e in zip(actual, expected, strict=True)), "rank_native_nll_proof_failed")
            offset, terms, weights, expected_gradients = 0, [], [], []
            for parent in parents:
                count = len(parent)
                terms.append(losses[offset:offset + count].mean() / 10)
                weights.extend([{"numerator": 1, "denominator": 10 * count}] * count)
                expected_gradients.extend([[g / (10 * count) for g in analytic_gradient(*pair)] for pair in parent])
                offset += count
            objective = torch.stack(terms).sum()
            expected_objective = rank.parent_mean_loss(parents)
            require(math.isclose(rank.finite(objective.item()), expected_objective, rel_tol=tolerance, abs_tol=tolerance),
                    "rank_native_parent_weight_proof_failed")
            objective.backward()
            gradients = logits.grad.detach().cpu().tolist()
            require(all(math.isclose(rank.finite(a), e, rel_tol=tolerance, abs_tol=tolerance)
                        for actual_row, expected_row in zip(gradients, expected_gradients, strict=True)
                        for a, e in zip(actual_row, expected_row, strict=True))
                    and all(math.isclose(row[0], -row[1], rel_tol=tolerance, abs_tol=tolerance) for row in gradients),
                    "rank_native_equal_opposite_gradient_proof_failed")
            reports.append({"device": device, "dtype": str(dtype), "absoluteTolerance": tolerance, "relativeTolerance": tolerance,
                "logitsAndLabels": flat, "candidateLosses": actual, "referenceLosses": expected,
                "weights": weights, "parentCount": 10, "candidateCounts": [len(p) for p in parents],
                "objective": objective.item(), "referenceObjective": expected_objective,
                "gradients": gradients, "referenceGradients": expected_gradients})
            del logits, labels, losses, objective, terms
    return {"version": "association-fragment-rank-technical-proof/1", "isolatedSyntheticLogitsOnly": True,
            "modelParametersUsedOrUpdated": False, "trainingLabelsRead": False, "reports": reports, "passed": True}


def run_scores(model, tokenizer, prepared, contexts, schema, contract, family, torch, gpu_check, preserve_raw, preserve_technical, *, reload_session=None):
    if reload_session is None:
        require(type(model).__name__ == "Qwen2ForCausalLM" and model.config.model_type == "qwen2", "rank_original_qwen2_required")
    else:
        from .fragment_rank_reload import _Session
        require(type(reload_session) is _Session and reload_session.model is model
            and type(reload_session.proof) is dict and reload_session.proof["passed"] is True, "rank_reload_native_proof_required")
    gpu_check()
    if reload_session is None:
        try:
            proof = technical_loss_proof(torch)
        except Exception as error:
            preserve_technical({"version": "association-fragment-rank-technical-proof/1", "passed": False,
                "isolatedSyntheticLogitsOnly": True, "modelParametersUsedOrUpdated": False, "trainingLabelsRead": False,
                "error": str(error)})
            raise
        preserve_technical(proof)
    gpu_check()
    records = []
    for item in prepared:
        options = {"reload_session": reload_session} if reload_session is not None else {}
        record = score_focus(model, tokenizer, item, torch, gpu_check, **options)
        preserve_raw(len(records), record)  # evidence survives a later failed score/vector
        records.append(record)
    vectors, results = project_records(records, prepared, contexts, schema, contract, family)
    result = {"version": "association-fragment-rank-result/1", "results": results, "scoreVectors": vectors,
        "modelOutputValidCount": len(results), "exampleCount": len(results), "scoreCount": len(records),
        "representation": rank.metadata(), "nativeLabelBoundaryVerified": True, "nativeTechnicalLossProofPassed": True,
        "retrievedFragmentCount": sum(row["retrievedFragmentCount"] for row in results),
        "evaluationOpened": False, "teacherOutputsUsed": False, "fitPerformed": False,
        "expectedSelectionsEvaluated": False, "teacherTargetsInPrompt": False,
        "qualification": "deterministic threshold/projection of model support scores; empty means no support in supplied context, not property absence; relevance/source truth/canonical association unqualified"}
    if reload_session is not None:
        proof = reload_session.finish(model)
        preserve_technical(proof)
        result.update(version="association-fragment-rank-reload-result/1", adapterApplied=True,
            nativeTechnicalLossProofPassed=None, technicalLossProofOrigin="accepted historical fit; not rerun in reload",
            nativeReloadProof=proof, scoreOrigin="accepted_rank_adapter_last_prompt_position", fitPerformedInThisProcess=False)
    return records, result
