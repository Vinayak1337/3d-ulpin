"""Focused MODEL-EGRESS-02 regressions; stdlib only, never import a model.

--control creates a fresh minimal runtime and runs one technical payload, then
injects response-evidence failures to verify provisional outputs stay unaccepted.
"""
from __future__ import annotations

import argparse
import builtins
import copy
import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch
import uuid

import model_isolation as isolation

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "services/geo"))
from geo.usp_learning.resources import guarded_run


class BoundaryTests(unittest.TestCase):
    def test_direct_qwen_roles_refuse_before_private_reads_or_dependency_imports(self):
        import compare_reranker
        import train_reranker_lora
        imported = []
        original = builtins.__import__

        def checked(name, *args, **kwargs):
            if name.split(".")[0] in ("torch", "transformers", "peft", "psutil", "packaging"):
                imported.append(name)
                raise AssertionError("dependency imported before boundary")
            return original(name, *args, **kwargs)

        with patch.object(builtins, "__import__", checked):
            for module in (compare_reranker, train_reranker_lora):
                for role in (module.prepare, module.worker, module.checked_context):
                    with self.subTest(role=role.__qualname__, module=module.__name__):
                        with self.assertRaisesRegex(RuntimeError, "uncontained role refused"):
                            role(argparse.Namespace())
        self.assertEqual(imported, [])

    def test_spoofed_session_and_parent_markers_do_not_allow_host_role(self):
        with patch.dict(os.environ, {"USP_MODEL_SESSION": "Z:/does-not-exist/private.json",
                                     "USP_MODEL_SESSION_SHA256": "0" * 64,
                                     "USP_LEARNING_SUPERVISOR_PID": str(os.getpid())}):
            with self.assertRaisesRegex(RuntimeError, "uncontained role refused"):
                isolation.require_model_boundary()

    def test_missing_wrong_platform_and_profile_drift_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "explicit profile"):
            isolation.load_profile(None, None)
        with patch.object(isolation.os, "name", "posix"):
            with self.assertRaisesRegex(RuntimeError, "Windows AppContainer"):
                isolation.load_profile(None, None)

    def test_peak_effective_cap_exit_truncation_and_cleanup_gate(self):
        good = {"exitCode": 0, "outputTruncated": False, "tokenValidatedBeforeResume": True,
                "jobClosed": True,
                "jobValidatedBeforeResume": True, "peakJobMemoryBytes": 20,
                "effectiveJobBeforeResume": {"limitFlags": 0x2200, "jobMemoryLimitBytes": 100}}
        isolation.accept_launch(good, 100, {"passed": True})
        for peak in (None, -1, 0, True, "20", 101):
            with self.subTest(peak=peak), self.assertRaisesRegex(RuntimeError, "Job peak"):
                isolation.accept_launch({**good, "peakJobMemoryBytes": peak}, 100, {"passed": True})
        for mutation in ({"exitCode": 1}, {"outputTruncated": True}, {"jobValidatedBeforeResume": False}, {"jobClosed": False},
                         {"effectiveJobBeforeResume": {"limitFlags": 0x2200, "jobMemoryLimitBytes": 200}}):
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                isolation.accept_launch({**good, **mutation}, 100, {"passed": True})
        with self.assertRaisesRegex(RuntimeError, "cleanup"):
            isolation.accept_launch(good, 100, {"passed": False})

    def test_only_explicit_environment_and_isolated_bootstrap(self):
        with patch.dict(os.environ, {"MODEL_EGRESS_SENTINEL": "technical-only"}):
            with patch.object(isolation, "sha", return_value="0" * 64):
                environment = isolation.explicit_environment(Path("E:/task"), Path("E:/task/session.json"))
        self.assertNotIn("MODEL_EGRESS_SENTINEL", environment)
        self.assertNotIn("USP_LEARNING_SUPERVISOR_PID", environment)
        for key in ("HTTPS_PROXY", "HF_TOKEN", "OPENAI_API_KEY"):
            self.assertNotIn(key, environment)


CONTROL = '''import argparse,json,os
from pathlib import Path
from model_isolation import require_model_boundary
p=argparse.ArgumentParser()
p.add_argument('action');p.add_argument('--output-dir',type=Path)
p.add_argument('--containment-profile',type=Path);p.add_argument('--containment-sha256')
p.add_argument('--_worker',action='store_true');a=p.parse_args()
root,profile,session=require_model_boundary(a)
assert 'MODEL_EGRESS_SENTINEL' not in os.environ
assert not any(name in __import__('sys').modules for name in ('torch','transformers','peft','psutil'))
denied=[]
for directory in ('code','inputs','model','runtime','state','receipts'):
 try: (root/directory/'unexpected.txt').write_text('technical marker')
 except PermissionError: denied.append(directory)
 else: raise AssertionError('readonly scope writable')
a.output_dir.mkdir()
(a.output_dir/'probe.json').write_text(json.dumps({'environmentKeys':sorted(os.environ),'deniedWrites':denied,'modelImported':False}))
print(json.dumps({'control':'restricted_stdlib_pass','modelImported':False,'deniedWrites':denied}))
'''


def control():
    root = isolation.STAGING_PARENT / ("control-" + uuid.uuid4().hex)
    root.mkdir(parents=True)
    for relative in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / relative).mkdir()
    source = Path("C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none")
    require_free = 300 * 1024**2
    assert shutil.disk_usage(root).free > require_free
    for name in ("python.exe", "python311.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        shutil.copyfile(source / name, root / "runtime" / name)
    for name in ("Lib", "DLLs"):
        shutil.copytree(source / name, root / "runtime" / name, ignore=shutil.ignore_patterns("site-packages", "__pycache__", "test", "tests"))
    copied = [isolation.HELPER, isolation.HARNESS, "scripts/usp/learning/compare_reranker.py",
              "scripts/usp/learning/train_reranker_lora.py"]
    for relative in copied:
        target = root / "code" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO / relative, target)
    (root / "code/control.py").write_text(CONTROL, encoding="utf-8")
    profile = {"schemaVersion": "usp-qwen-containment-v1", "root": str(root), "python": "runtime/python.exe",
               "packageRoots": [], "jobMemoryBytes": 128 * 1024**2, "timeoutSeconds": 10,
               "files": {p.relative_to(root).as_posix(): isolation.sha(p) for directory in isolation.READONLY
                         for p in (root / directory).rglob("*") if p.is_file()}}
    isolation.write(root / "profile.json", profile)
    digest = isolation.sha(root / "profile.json")
    limits = {"maxPeakProcessRssBytes": 128 * 1024**2, "maxRunSeconds": 10, "maxFitSeconds": 10}

    def command(role, action):
        return [sys.executable, role, action, "--output-dir", str(root / "outputs/probe"),
                "--containment-profile", str(root / "profile.json"), "--containment-sha256", digest]

    with patch.dict(os.environ, {"MODEL_EGRESS_SENTINEL": "technical-only"}):
        report = guarded_run(command("control.py", "prepare"), root / "receipts", limits,
                             containment_profile=root / "profile.json", containment_sha256=digest)
    assert report["exitCode"] == 0, report["failure"]
    assert report["cleanup"]["passed"] and report["outputsAccepted"]
    assert (root / "receipts/control-prepare-accepted.json").exists()
    probe = isolation.read(root / "outputs/probe/probe.json")
    assert "MODEL_EGRESS_SENTINEL" not in probe["environmentKeys"]
    # A valid zero child exit cannot accept missing or excessive final Job peaks.
    api = isolation.audit_module(REPO / isolation.HARNESS)
    rejected = []
    for role, peak in (("compare_reranker.py", None), ("train_reranker_lora.py", profile["jobMemoryBytes"] + 1)):
        observation = copy.deepcopy(report["observation"])
        observation["peakJobMemoryBytes"] = peak
        def response(exe, args, sid, *a, **kw):
            observation["token"]["appContainerSid"] = api.sid_string(sid)
            return observation
        with patch.object(isolation, "audit_module", return_value=api), patch.object(api, "launch", side_effect=response):
            failed = isolation.launch_model(command(role, "run"), root / "receipts", limits, root / "profile.json", digest)
        assert failed["exitCode"] == 1 and not failed["outputsAccepted"] and failed["cleanup"]["passed"]
        assert not (root / "receipts" / (Path(role).stem + "-run-accepted.json")).exists()
        rejected.append({"role": role, "injectedPeak": peak, "failure": failed["failure"]})
    # A configuration readback mismatch is rejected while an actual child is suspended.
    sys.path.insert(0, str(REPO / "scripts/usp/security"))
    import test_appcontainer_controls as controls
    name, sid = controls.profile()
    expected_sid = controls.audit.sid_string(sid)
    tracked = []
    try:
        controls.grant([root, root / "runtime", root / "runtime/python.exe"], expected_sid, tracked)
        before_resume = controls.job_limit_rejection(root / "runtime/python.exe", sid)
    finally:
        before_resume_cleanup = controls.capture_cleanup(tracked, expected_sid, name, sid)
    controls.assert_revoked(tracked, expected_sid)
    try:
        isolation.load_profile(root / "profile.json", "0" * 64)
    except RuntimeError as error:
        assert "profile SHA256 drift" in str(error)
    else:
        raise AssertionError("changed profile accepted")
    receipt = {"status": "no_model_controls_pass", "root": str(root), "profileSha256": digest,
               "effectiveCapRejectionBeforeResume": before_resume, "effectiveCapRejectionCleanup": before_resume_cleanup,
               "realLaunch": report, "rejectedResponses": rejected,
               "modelImported": False, "sourceSha256": {name: isolation.sha(REPO / name) for name in
               [*copied, "services/geo/geo/usp_learning/resources.py", "scripts/usp/learning/test_model_isolation.py",
                "scripts/usp/security/test_appcontainer_controls.py"]},
               "artifactSha256": {p.relative_to(root).as_posix(): isolation.sha(p)
                                 for p in (root / "receipts").rglob("*") if p.is_file()}}
    isolation.write(root / "controls.json", receipt)
    print(json.dumps({"root": str(root), "status": receipt["status"], "controlsSha256": isolation.sha(root / "controls.json")}))


if __name__ == "__main__":
    if sys.argv[1:] == ["--control"]:
        control()
    else:
        unittest.main()
