#!/usr/bin/env python3
"""Prepare/run one unchanged local RF-DETR reference. No fitting or downloads.

Preparation and plan inspection use stdlib only. --reference-run additionally
requires a current-process root authorization and separately verified containment.
--experimental-baseline-run is a distinct v2 experiment: numeric differences
remain observations, while complete valid ALL24 inference defines completion.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import struct
import sys
import time
import zipfile

VERSION = "ramp-torch-reference-plan/1"
BASELINE_VERSION = "ramp-torch-baseline-plan/2"
BASELINE_MODE = "experimental-baseline"
ROOT_THREAD = "01a0ed8a-4383-79c3-a0ae-35c1e969ef66"
MODEL_OWNER = "01a0fbd5-4561-7692-b366-ebd123380593"
PRIVATE = Path("E:/BhuAayam-data/task-data/d07-rfdetr-torch-reference-20261005")
BASELINE_PRIVATE = Path("E:/BhuAayam-data/task-data/d07-rfdetr-torch-baseline-20261005")
MOUNTED = Path("E:/BhuAayam-data/task-data/d07-rfdetr-mounted-plan-20261005")
BASELINE = Path("E:/BhuAayam-data/task-data/d07-karnataka-baseline-20261005")
COCO = Path("E:/BhuAayam-data/task-data/d06-ramp-coco-20261005")
CONFIG_SHA = "14d3936c88b983a5838f027bc411c9a656804de6b301f8e5be6d1aa6a87cf367"
PLAN_SHA = "14343270b4511007b6d0bdbcfb6b4f473f4f60b20d5ee49f95b971af7fcdb9ac"
FREEZE_SHA = "9b580000468c6db12e9d74a2ff25e68fa44eed289204e9fd73dd4461acbffe2c"
RESULTS_SHA = "57becbda6d0058e1e07cca834a29965c193ec60c598d040ef2531172980b0dc1"
COHORT_SHA = "808b423e8e4602a984eaa89c2c6d2294ae3b2b8b73bfe3b07d19331e5d35afeb"
CONTRACT = {"output0": [1, 200, 1], "output1": [1, 200, 108, 108]}
PREPROCESS = {"rgbResize": "Pillow RGB BILINEAR432", "processorResize": False, "processorPad": False,
    "rescale": 1 / 255, "mean": [.485, .456, .406], "std": [.229, .224, .225],
    "inputShape": [1, 3, 432, 432], "dtype": "float32", "tf32": False, "autocast": False,
    "confidenceThreshold": .5, "maskLogitThreshold": 0, "queries": "all200, original order; no filtering"}
PARITY = {"inputAtol": 1e-6, "inputRtol": 0, "outputAtol": 1e-4, "outputRtol": 1e-4,
    "alignment": "same query index; no permutation, threshold tuning or favourable subset",
    "basis": "FP32 eager CUDA versus retained CPU ONNX; fixed tolerances before execution. Report both numeric and threshold disagreements, even on failure.",
    "limitation": "Historical432 input tensors were not retained. Current processor-versus-production-formula input check is separate from cached output parity; Pillow11.0 versus baseline11.2.1/NumPy2.0.2/ORT1.19.2 can matter. Same source weights do not establish numerical parity."}
BASELINE_POLICY = {"experiment": "ramp-torch-own-baseline/2", "role": "open_development_only",
    "groupId": "ramp-MaxarODP-104001002CA32300", "items": 24, "positive": 19, "sourceEmpty": 5,
    "publisherRoofInstances": 178, "fit": False, "promotion": False, "onnxEquivalence": False,
    "completion": "all24_original_order_valid_load_input_finite_outputs_and_containment",
    "numericComparison": "unchanged_same_index_tolerance_reported_separately_not_a_completion_gate",
    "quality": "not_scored_by_runner; reuse_cached_production_scorer_at_0.5/logit0; no_assumed_pass"}
PREREQUISITES = {
    "originalExecution": {"path": "/inputs/reference/prerequisites/original-execution.json", "bytes": 14033,
        "sha256": "5abf5ab3390020c90785d235b8635e192a596cfefde81478ea802aa95f78b9a8"},
    "originalSmokeResult": {"path": "/inputs/reference/prerequisites/original-smoke-result.json", "bytes": 2637,
        "sha256": "2dc7ff9d59fc381b03b4392ee165676a204898684b99252be6e57a76d3c79da8"},
    "cachedDiagnosis": {"path": "/inputs/reference/prerequisites/cached-diagnosis.json", "bytes": 9911,
        "sha256": "ce3b79d7258deaf2258608a9788b40f146cc95bd58edab2a5a34ff002fa88dfe"}}


def require(condition, message):
    if not condition: raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def unlinked(path):
    path = Path(path).absolute()
    for part in [path, *path.parents]:
        if part.exists() or part.is_symlink():
            require(not part.is_symlink() and not (getattr(part.lstat(), "st_file_attributes", 0) & 0x400), "Linked input/output refused")
    return path.resolve()


def pin(path, maximum=512 * 1024**2):
    path = unlinked(path)
    require(path.is_file() and 0 < path.stat().st_size <= maximum, "Missing/oversized artifact")
    with path.open("rb") as stream: sha = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha}


def checked(entry):
    actual = pin(entry["path"])
    require(actual["bytes"] == entry["bytes"] and actual["sha256"] == entry["sha256"], "Pinned artifact drift: " + entry["path"])
    return Path(entry["path"])


def read(path):
    require(Path(path).stat().st_size <= 1024**2, "Oversized metadata")
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def invalid(value): raise ValueError("Non-finite JSON")
    return json.loads(Path(path).read_bytes(), object_pairs_hook=pairs, parse_constant=invalid)


def save(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


def header_contract(name, header, size):
    require(name in CONTRACT and set(header) == {"descr", "fortran_order", "shape"} and
            header["descr"] == "<f4" and header["fortran_order"] is False and
            list(header["shape"]) == CONTRACT[name] and size <= 9_400_000, "Unsupported raw array contract")


def inspect_archive(path):
    """Only bounded ZIP/NPY headers; no array/library/tensor load."""
    require(Path(path).stat().st_size <= 16 * 1024**2, "Oversized native archive")
    with zipfile.ZipFile(path) as archive:
        require(archive.namelist() == ["output0.npy", "output1.npy"], "Native archive must contain exactly two ordered outputs")
        for entry in archive.infolist():
            require(entry.file_size <= 9_400_000, "Oversized NPY entry")
            with archive.open(entry) as stream:
                magic = stream.read(8)
                require(magic[:6] == b"\x93NUMPY" and magic[6:8] in {b"\x01\x00", b"\x02\x00"}, "Unsupported NPY header")
                length = struct.unpack("<H" if magic[6] == 1 else "<I", stream.read(2 if magic[6] == 1 else 4))[0]
                require(0 < length <= 512, "Oversized NPY header")
                header_contract(entry.filename[:-4], ast.literal_eval(stream.read(length).decode("ascii")), entry.file_size)


def validate_plan(plan):
    baseline = plan["schemaVersion"] == BASELINE_VERSION and plan["mode"] == BASELINE_MODE
    require((baseline or (plan["schemaVersion"] == VERSION and plan["mode"] in {"smoke", "development"})) and
            plan["executionAuthorized"] is False and plan["outputContract"] == CONTRACT and
            plan["preprocessing"] == PREPROCESS and plan["parityPolicy"] == PARITY, "Unsupported reference protocol")
    cohort = plan["cohort"]
    require(len(cohort) == 24 and digest(cohort) == COHORT_SHA and len({i["id"] for i in cohort}) == 24 and
            sum(i["sourceEmpty"] for i in cohort) == 5, "Only the complete fixed Karnataka open-development cohort is allowed")
    smoke = [next(i["id"] for i in cohort if not i["sourceEmpty"]), next(i["id"] for i in cohort if i["sourceEmpty"])]
    require(plan["selectedIds"] == (smoke if plan["mode"] == "smoke" else [i["id"] for i in cohort]), "Subset/reordered reference refused")
    require(plan["mountedConfig"]["sha256"] == CONFIG_SHA and plan["mountedConfig"]["path"] == "/inputs/plan/mounted-config.json" and
            plan["scriptPin"]["path"] == "/inputs/reference/compare_ramp_torch.py" and
            plan["outputDir"] == ("/outputs/rfdetr/experimental-baseline-v2" if baseline else
                                   "/outputs/rfdetr/reference-" + plan["mode"]), "Undeclared runtime path")
    if baseline:
        require(plan["baselinePolicy"] == BASELINE_POLICY and plan["prerequisites"] == PREREQUISITES,
                "Only the fixed no-fit v2 baseline and accepted prerequisites are supported")
    require(plan["planSha256"] == digest({k: v for k, v in plan.items() if k != "planSha256"}), "Reference plan digest drift")


def prepare():
    original_pins = [(MOUNTED / "mounted-config-runtime-v1.json", CONFIG_SHA), (MOUNTED / "mounted-plan-runtime-v1.json", PLAN_SHA),
        (BASELINE / "frozen-config.json", FREEZE_SHA), (BASELINE / "results.json", RESULTS_SHA)]
    origins = []
    for path, sha in original_pins:
        entry = pin(path); require(entry["sha256"] == sha, "Accepted metadata drift"); origins.append(entry)
    config, mounted_plan, freeze, results = [read(p[0]) for p in original_pins]
    manifest_pin = {**config["config"]["datasetManifest"], "path": str(unlinked(COCO / "manifest.json"))}
    manifest = read(checked(manifest_pin))
    require(freeze["developmentOnly"] is True and freeze["groupReservation"]["items"] == 24 and
            manifest["fitAdmission"] == "not_fit_admitted" and manifest["finalOrTestSelection"] is False, "No fit/final admission")
    exported = {i["sourceId"]: i for i in manifest["images"] if i["split"] == "valid"}
    cohort, native_mounts = [], []
    for source, result in zip(freeze["items"], results["items"], strict=True):
        row = exported[source["id"]]
        require(result["id"] == source["id"] and source["groupId"] == row["sourceGroup"] == "ramp-MaxarODP-104001002CA32300" and
                row["image"]["sha256"] == source["image"]["sha256"] and row["image"]["bytes"] == source["image"]["bytes"], "Source reference mismatch")
        image = {**row["image"], "path": "/inputs/coco/valid/" + Path(row["image"]["path"]).name}
        host_native = BASELINE / "raw" / source["id"].replace("/", "--") / "native-00.npz"
        native = {**result["artifacts"]["native-00.npz"], "path": "/inputs/reference/onnx/" + source["id"].replace("/", "--") + "/native-00.npz"}
        require(host_native.stat().st_size == native["bytes"], "Cached native size drift")
        cohort.append({"id": source["id"], "sourceEmpty": source["sourceEmpty"], "image": image, "onnx": native})
        native_mounts.append({"hostPath": str(unlinked(host_native)), "containerPath": native["path"], "readOnly": True, "kind": "file", "pin": native})
    require(digest(cohort) == COHORT_SHA, "Frozen source/cache identity changed")
    smoke = [next(i["id"] for i in cohort if not i["sourceEmpty"]), next(i["id"] for i in cohort if i["sourceEmpty"])]
    for item in cohort:
        if item["id"] in smoke: inspect_archive(BASELINE / "raw" / item["id"].replace("/", "--") / "native-00.npz")
    root = unlinked(PRIVATE)
    require(not root.exists(), "Preparation output already exists; preserve it")
    root.mkdir()
    snapshot = root / "compare_ramp_torch.py"
    with snapshot.open("xb") as out: out.write(Path(__file__).read_bytes())
    script_pin = {**pin(snapshot), "path": "/inputs/reference/compare_ramp_torch.py"}
    interface = {"kind": "prepared_only_new_root_execution_assignment_required", "baseInterface": pin(MOUNTED / "launch-interface-runtime-v1.json"),
        "replaceWritableOutput": {"hostPath": str(root / "output"), "containerPath": "/outputs/rfdetr", "readOnly": False}, "modes": {}}
    for mode in ["smoke", "development"]:
        selected = smoke if mode == "smoke" else [i["id"] for i in cohort]
        plan = {"schemaVersion": VERSION, "mode": mode, "mountedConfig": {**origins[0], "path": "/inputs/plan/mounted-config.json"},
            "scriptPin": script_pin, "cohort": cohort, "selectedIds": selected, "outputDir": "/outputs/rfdetr/reference-" + mode,
            "preprocessing": PREPROCESS, "outputContract": CONTRACT, "parityPolicy": PARITY, "origins": origins,
            "runtime": config["runtimeBinding"], "originalModel": {k: mounted_plan[k] for k in ["weights", "modelConfig", "processorConfig"]},
            "executionAuthorized": False}
        plan["planSha256"] = digest(plan); validate_plan(plan)
        plan_path = root / (mode + "-plan.json"); save(plan_path, plan)
        interface["modes"][mode] = {"newReadOnlyMounts": [{"hostPath": str(snapshot), "containerPath": script_pin["path"], "readOnly": True, "kind": "file", "pin": script_pin},
            {"hostPath": str(plan_path), "containerPath": "/inputs/reference/plan.json", "readOnly": True, "kind": "file", "pin": pin(plan_path)},
            *[m for i, m in zip(cohort, native_mounts, strict=True) if i["id"] in selected]],
            "argv": ["/opt/conda/bin/python", "-I", "-B", script_pin["path"], "--plan", "/inputs/reference/plan.json", "--reference-run",
                     "--authorization", "/inputs/reference/authorization.json", "--authorization-sha256", "<actual-root-receipt-sha256>"],
            "futureUnsealedGateMounts": ["Exact root authorization JSON", "Exact actual current-process native-control receipt", *(["Exact successful smoke result JSON"] if mode == "development" else [])],
            "gpuChange": "Explicit root assignment must replace no-device/void profile with sole-owner RTX3070 cuda:0 scope and bounded monitored resources. No device or launch authorized here."}
    save(root / "mount-interface.json", interface)
    print(json.dumps({"state": "prepared_only", "smokeIds": smoke, "fullDevelopment": 24, "plans": [pin(root / (m + "-plan.json")) for m in ["smoke", "development"]], "interface": pin(root / "mount-interface.json")}))


def baseline_prerequisites(plan, entries):
    """Read exact accepted prior evidence; failed numeric smoke stays failed."""
    require(set(entries) == set(PREREQUISITES), "Complete baseline prerequisites required")
    for key, entry in entries.items():
        require({k: entry[k] for k in ("bytes", "sha256")} ==
                {k: PREREQUISITES[key][k] for k in ("bytes", "sha256")}, "Baseline prerequisite identity drift")
    execution, smoke, diagnosis = [read(checked(entries[k])) for k in PREREQUISITES]
    expected = [next(i["id"] for i in plan["cohort"] if not i["sourceEmpty"]),
                next(i["id"] for i in plan["cohort"] if i["sourceEmpty"])]
    require(execution["status"] == "smoke_executed_parity_failed_all24_not_admitted" and
            execution["loading"]["state"] == "unchanged_checkpoint_load_and_two_inferences_completed" and
            execution["runner"]["sha256"] == "cb771a12ac46ee4ae448bd90ce42574676d9a6afc28ac147aa1cd9e98212e0a1" and
            execution["execution"]["result"]["sha256"] == PREREQUISITES["originalSmokeResult"]["sha256"] and
            execution["runtime"]["imageDigest"] == plan["runtime"]["imageDigest"], "Accepted original load/image evidence required")
    require(execution["loading"]["checksPassedBeforeInference"] == [
        "empty missing_keys/unexpected_keys/mismatched_keys/error_msgs",
        "original one-building-class head,200queries,custom kernels disabled",
        "local-only safetensors,eager,eval,FP32,inference_mode; no TF32/autocast/compile"], "Accepted strict load/head checks missing")
    for key in ("weights", "modelConfig", "processorConfig"):
        require(all(execution["loading"]["model"][key][k] == plan["originalModel"][key][k]
                    for k in ("bytes", "sha256")), "Baseline model differs from accepted original load")
    require(smoke["schemaVersion"] == "ramp-torch-reference-result/1" and smoke["mode"] == "smoke" and
            smoke["state"] == "reference_completed_parity_failed" and smoke["cohortSha256"] == COHORT_SHA and
            smoke["scriptSha256"] == execution["runner"]["sha256"] and
            [i["id"] for i in smoke["items"]] == expected and
            all(i["numericParityPassed"] is False and 0 <= i["inputMaxAbs"] <= PARITY["inputAtol"]
                for i in smoke["items"]), "Original successful inputs and failed numeric result must be preserved")
    require(diagnosis["schemaVersion"] == "rfdetr-cached-parity-diagnosis/1" and
            [i["id"] for i in diagnosis["items"]] == expected and
            all(all(i["historicalCacheReproduction"].values()) and i["projection"]["foregroundXorPixels"] == 0
                for i in diagnosis["items"]), "Exact accepted cached diagnosis required")


def prepare_baseline():
    """Freeze v2 from accepted v1 metadata; no data/model/archive reads."""
    old_plan_pin = {"path": str(PRIVATE / "development-plan.json"), "bytes": 25998,
        "sha256": "88a3b33c742044c19d868d31b3d19a362b65c7e113899f1367b89a22f71fdfca"}
    old_interface_pin = {"path": str(PRIVATE / "mount-interface.json"), "bytes": 20132,
        "sha256": "dca3b54f2ca7401cf2b3a02656d845a6985b023d79db309b4cbfe2a9d754c993"}
    plan = read(checked(old_plan_pin)); validate_plan(plan)
    require(plan["mode"] == "development" and plan["scriptPin"]["sha256"] ==
            "cb771a12ac46ee4ae448bd90ce42574676d9a6afc28ac147aa1cd9e98212e0a1", "Use original prepared full24 metadata")
    interface = read(checked(old_interface_pin))
    paths = {"originalExecution": BASELINE_PRIVATE / "original-execution.json",
        "originalSmokeResult": PRIVATE / "output/reference-smoke/result.json",
        "cachedDiagnosis": Path("E:/BhuAayam-data/task-data/d07-rfdetr-parity-diagnosis-20261005/diagnostic.json")}
    evidence = {k: {**PREREQUISITES[k], "path": str(unlinked(p))} for k, p in paths.items()}
    baseline_prerequisites(plan, evidence)
    root = unlinked(BASELINE_PRIVATE / "prepared-v2")
    require(not root.exists(), "Baseline preparation already exists; preserve it")
    root.mkdir()
    snapshot = root / "compare_ramp_torch.py"
    with snapshot.open("xb") as out: out.write(Path(__file__).read_bytes())
    script_pin = {**pin(snapshot), "path": "/inputs/reference/compare_ramp_torch.py"}
    plan.update(schemaVersion=BASELINE_VERSION, mode=BASELINE_MODE, scriptPin=script_pin,
        outputDir="/outputs/rfdetr/experimental-baseline-v2", baselinePolicy=BASELINE_POLICY,
        prerequisites=PREREQUISITES)
    plan["planSha256"] = digest({k: v for k, v in plan.items() if k != "planSha256"}); validate_plan(plan)
    plan_path = root / "baseline-plan.json"; save(plan_path, plan)
    mounts = interface["modes"]["development"]["newReadOnlyMounts"][2:]
    require([m["containerPath"] for m in mounts] == [i["onnx"]["path"] for i in plan["cohort"]] and
            all(m["readOnly"] is True and m["pin"] == i["onnx"] for m, i in zip(mounts, plan["cohort"], strict=True)), "Complete ordered24 cache mounts required")
    invocation = {"schemaVersion": "ramp-torch-baseline-interface/2", "state": "prepared_only",
        "baseInterface": interface["baseInterface"], "originalPlan": old_plan_pin, "originalInterface": old_interface_pin,
        "replaceWritableOutput": {"hostPath": str(BASELINE_PRIVATE / "output"), "containerPath": "/outputs/rfdetr", "readOnly": False},
        "newReadOnlyMounts": [
            {"hostPath": str(snapshot), "containerPath": script_pin["path"], "readOnly": True, "kind": "file", "pin": script_pin},
            {"hostPath": str(plan_path), "containerPath": "/inputs/reference/plan.json", "readOnly": True, "kind": "file", "pin": pin(plan_path)},
            *mounts, *[{"hostPath": str(paths[k]), "containerPath": PREREQUISITES[k]["path"], "readOnly": True, "kind": "file", "pin": PREREQUISITES[k]} for k in paths]],
        "argv": ["/opt/conda/bin/python", "-I", "-B", script_pin["path"], "--plan", "/inputs/reference/plan.json", "--experimental-baseline-run",
            "--authorization", "/inputs/reference/authorization.json", "--authorization-sha256", "<actual-root-receipt-sha256>"],
        "futureUnsealedGateMounts": ["Exact v2 root authorization JSON binding all3 prerequisites", "Exact current-process native-control/resource receipt"],
        "requiredAuthorizationSchema": "ramp-torch-baseline-authorization/2",
        "gpuChange": "Teacher must independently verify/review this contract and receive separate root sole-GPU execution authority, exact PID/image/env/mount/network/resource controls and cleanup. No execution authorized by preparation."}
    save(root / "mount-interface.json", invocation)
    print(json.dumps({"state": "prepared_only", "mode": BASELINE_MODE, "items": 24, "plan": pin(plan_path), "interface": pin(root / "mount-interface.json")}))


def authorize(plan, path, sha):
    require(path is not None and sha is not None, "Reference blocked: exact actual-process root authorization required before heavy imports")
    require(pin(path)["sha256"] == sha, "Authorization pin drift")
    gate = read(path)
    baseline = plan["schemaVersion"] == BASELINE_VERSION
    require(gate["schemaVersion"] == ("ramp-torch-baseline-authorization/2" if baseline else "ramp-torch-reference-authorization/1") and gate["rootThreadId"] == ROOT_THREAD and
            gate["rootAuthorized"] is True and gate["mode"] == plan["mode"] and gate["planSha256"] == plan["planSha256"] and
            gate["scriptSha256"] == pin(__file__)["sha256"], "Reference not authorized for this exact plan/code")
    runtime = plan["runtime"]
    control = read(checked(gate["preflightReceipt"]))
    require(control["pid"] == os.getpid() and control["imageDigest"] == runtime["imageDigest"] and control["modelOwner"] == MODEL_OWNER and
            control["effectiveNetworkDenied"] is True and control["effectiveResourceLimits"] is True and
            control["exactMountsAndEnvironmentVerified"] is True and control["gpuOwnerTransferred"] is True, "Actual reference process lacks exclusive contained resource handoff")
    if baseline:
        require(gate["baselinePolicy"] == BASELINE_POLICY and gate["prerequisites"] == plan["prerequisites"], "Explicit v2 experiment/prerequisite authorization required")
        baseline_prerequisites(plan, gate["prerequisites"])
    if plan["mode"] == "development":
        smoke = read(checked(gate["smokeResult"]))
        expected_ids = [next(i["id"] for i in plan["cohort"] if not i["sourceEmpty"]), next(i["id"] for i in plan["cohort"] if i["sourceEmpty"])]
        require(smoke["schemaVersion"] == "ramp-torch-reference-result/1" and smoke["mode"] == "smoke" and
                smoke["scriptSha256"] == gate["scriptSha256"] and smoke["cohortSha256"] == COHORT_SHA and
                [i["id"] for i in smoke["items"]] == expected_ids and all(i["numericParityPassed"] for i in smoke["items"]), "Successful same-code smoke parity required before ALL24 reference")
    return gate


def reference_run(plan):
    """Only inference; external native/resource controls are mandatory."""
    config = read(checked(plan["mountedConfig"]))
    runtime = config["runtimeBinding"]
    require(plan["originalModel"] == {k: config["config"][k] for k in ["weights", "modelConfig", "processorConfig"]}, "Only the exact unchanged mounted checkpoint/config/processor are supported")
    require(runtime == plan["runtime"] and sys.platform == "linux" and os.uname().machine == "x86_64" and
            ".".join(map(str, sys.version_info[:3])) == runtime["pythonVersion"] and
            Path(sys.executable).resolve() == Path(runtime["pythonExecutable"]).resolve(), "Runtime Python/platform/binding drift")
    require(all(importlib.metadata.version(k) == v for k, v in runtime["packageVersions"].items()), "Exact complete dependency lock required")
    for entry in plan["originalModel"].values(): checked(entry)
    require(checked(plan["scriptPin"]) == Path(__file__).resolve(), "Use exact declared runner")
    out = unlinked(plan["outputDir"])
    require(out.parent == Path("/outputs/rfdetr") and not out.exists(), "New isolated reference output required")
    out.mkdir()
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    import numpy as np
    import torch
    from PIL import Image
    from transformers import RfDetrForInstanceSegmentation, RfDetrImageProcessor
    torch.set_num_threads(2); torch.set_num_interop_threads(1)
    torch.backends.cuda.matmul.allow_tf32 = False; torch.backends.cudnn.allow_tf32 = False
    require(torch.cuda.is_available() and torch.cuda.device_count() == 1, "Exactly one root-assigned GPU required")
    original = str(Path(plan["originalModel"]["weights"]["path"]).parent)
    model, loading = RfDetrForInstanceSegmentation.from_pretrained(original, local_files_only=True, use_safetensors=True,
        attn_implementation="eager", dtype=torch.float32, output_loading_info=True)
    require(not any(loading.get(k) for k in ["missing_keys", "unexpected_keys", "mismatched_keys", "error_msgs"]), "Incomplete source checkpoint load; no replacements")
    require(model.config.id2label == {0: "building"} and model.config.label2id == {"building": 0} and
            model.config.num_labels == 1 and model.config.num_queries == 200 and model.config.disable_custom_kernels, "Original one-class architecture changed")
    model.eval(); model.to("cuda:0")
    require(not model.training and all(p.dtype == torch.float32 for p in model.parameters() if p.is_floating_point()), "Reference requires unchanged eval FP32 parameters")
    processor = RfDetrImageProcessor.from_pretrained(original, local_files_only=True)
    items = []
    for source in plan["cohort"]:
        if source["id"] not in plan["selectedIds"]: continue
        folder = out / source["id"].replace("/", "--"); folder.mkdir()
        with Image.open(checked(source["image"])) as image:
            require(image.size == (256, 256) and image.mode == "RGB" and image.getexif().get(274, 1) == 1, "Unsupported retained RGB source frame")
            rgb = image.resize((432, 432), Image.Resampling.BILINEAR)
        inputs = processor(images=rgb, do_resize=False, do_pad=False, return_segmentation_masks=False, return_tensors="pt")
        require(set(inputs) == {"pixel_values"} and list(inputs["pixel_values"].shape) == PREPROCESS["inputShape"] and inputs["pixel_values"].dtype == torch.float32, "Processor shape/padding drift")
        actual = inputs["pixel_values"].numpy()
        canonical = np.asarray(rgb).transpose(2, 0, 1).astype(np.float32) / 255
        canonical = ((canonical - np.array(PREPROCESS["mean"], np.float32)[:, None, None]) / np.array(PREPROCESS["std"], np.float32)[:, None, None])[None]
        input_max = float(np.max(np.abs(actual - canonical)))
        save(folder / "input-parity.json", {"maxAbs": input_max, "atol": PARITY["inputAtol"], "historicalInputRetained": False,
             "actualSha256": hashlib.sha256(actual.tobytes()).hexdigest(), "canonicalSha256": hashlib.sha256(canonical.tobytes()).hexdigest()})
        require(np.isfinite(actual).all() and np.allclose(actual, canonical, atol=PARITY["inputAtol"], rtol=0), "Processor/production-formula input parity failed before inference")
        started = time.perf_counter()
        with torch.inference_mode(): output = model(pixel_values=inputs["pixel_values"].to("cuda:0"))
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        arrays = {"output0": np.ascontiguousarray(output.logits.detach().cpu().numpy()),
                  "output1": np.ascontiguousarray(output.pred_masks.detach().cpu().numpy())}
        require(all(list(a.shape) == CONTRACT[k] and a.dtype == np.float32 and np.isfinite(a).all() for k, a in arrays.items()), "Invalid complete reference output")
        np.savez_compressed(folder / "native-00.npz", **arrays)
        inspect_archive(checked(source["onnx"]))
        parity = {}
        with np.load(source["onnx"]["path"], allow_pickle=False) as old:
            for key, new in arrays.items():
                previous = old[key]
                require(list(previous.shape) == CONTRACT[key] and previous.dtype == np.float32 and np.isfinite(previous).all(), "Invalid retained ONNX output")
                delta = np.abs(new.astype(np.float64) - previous.astype(np.float64))
                parity[key] = {"maxAbs": float(delta.max()), "meanAbs": float(delta.mean()),
                    "outsideTolerance": int((~np.isclose(new, previous, atol=PARITY["outputAtol"], rtol=PARITY["outputRtol"])).sum()),
                    "thresholdSignDisagreements": int(((new > 0) != (previous > 0)).sum())}
        item = {"id": source["id"], "source": source["image"], "sourceEmpty": source["sourceEmpty"], "seconds": elapsed,
            "inputMaxAbs": input_max, "parity": parity, "numericParityPassed": all(p["outsideTolerance"] == 0 for p in parity.values()),
            "artifacts": {"native-00.npz": {k: v for k, v in pin(folder / "native-00.npz").items() if k != "path"}}}
        save(folder / "reference.json", item); items.append(item)
        del output, arrays, inputs
    baseline = plan["schemaVersion"] == BASELINE_VERSION
    if baseline:
        require([i["id"] for i in items] == [i["id"] for i in plan["cohort"]], "Incomplete/reordered baseline cannot complete")
    result = {"schemaVersion": "ramp-torch-baseline-result/2" if baseline else "ramp-torch-reference-result/1", "mode": plan["mode"], "planSha256": plan["planSha256"],
        "scriptSha256": pin(__file__)["sha256"], "cohortSha256": COHORT_SHA, "items": items,
        "state": "reference_completed_parity_passed" if all(i["numericParityPassed"] for i in items) else "reference_completed_parity_failed",
        "trainingOrPromotion": False, "qualityScoring": "Reuse existing cached evaluator at unchanged0.5; raw archives compatible, no label/metric qualification here."}
    if baseline:
        result.update(state="experimental_baseline_completed", baselinePolicy=BASELINE_POLICY,
            prerequisites=plan["prerequisites"], numericComparisonState="all24_numeric_parity_passed" if
            all(i["numericParityPassed"] for i in items) else "all24_numeric_parity_failed",
            parityPolicy=PARITY, model=plan["originalModel"], runtime=plan["runtime"],
            qualification="own_route_open_development_baseline_only; no_ONNX_equivalence_fit_promotion_or_release_claim")
    save(out / "result.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--prepare-baseline", action="store_true")
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--reference-run", action="store_true")
    parser.add_argument("--experimental-baseline-run", action="store_true")
    parser.add_argument("--authorization", type=Path)
    parser.add_argument("--authorization-sha256")
    args = parser.parse_args()
    if args.prepare or args.prepare_baseline:
        require(not (args.prepare and args.prepare_baseline) and not args.plan and not args.reference_run and
                not args.experimental_baseline_run and not args.authorization and not args.authorization_sha256, "Preparation grants no execution")
        (prepare_baseline if args.prepare_baseline else prepare)(); return
    require(args.plan is not None, "Supply --prepare or --plan")
    execute = args.reference_run or args.experimental_baseline_run
    require(not (args.reference_run and args.experimental_baseline_run), "One explicit execution contract required")
    if execute:
        require(args.authorization is not None and args.authorization_sha256 is not None, "Reference blocked: root authorization required before heavy imports")
    plan = read(args.plan); validate_plan(plan)
    if execute:
        require(args.experimental_baseline_run == (plan["schemaVersion"] == BASELINE_VERSION), "Execution mode and versioned plan must agree")
        authorize(plan, args.authorization, args.authorization_sha256)
        print(json.dumps(reference_run(plan), indent=2))
    else:
        print(json.dumps({"state": "prepared_only", "mode": plan["mode"], "items": len(plan["selectedIds"]), "planSha256": plan["planSha256"]}))


if __name__ == "__main__":
    try: main()
    except (ValueError, KeyError, OSError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"state": "blocked", "error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
