"""One no-model Docker native-boundary control; no fit/inference entry point.

The cached geo image qualifies only this primitive. A matching Linux training
runtime/config and GPU control remain prerequisites for RF-DETR execution.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import uuid

IMAGE = "sha256:e71d87961be773c18685622eb570c034cf664bfa206e21f6fa3691d629b440c9"
TASK = "d07-rfdetr-containment-20261005"
ROOT = Path("E:/BhuAayam-data/task-data/" + TASK)
MEMORY = 5 * 1024**3  # Plus a 512 MiB host Job stays below the 6 GiB task cap.


def save(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as out:
        json.dump(value, out, indent=2, allow_nan=False)
        out.write("\n")


def pin(path):
    data = Path(path).read_bytes()
    return {"path": str(Path(path).resolve()), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def worker():
    import resource
    if sys.platform != "linux" or os.getuid() != 10001:
        raise RuntimeError("Expected isolated Linux non-root worker")
    interfaces = sorted(p.name for p in Path("/sys/class/net").iterdir())
    if interfaces != ["lo"]:
        raise RuntimeError("Unexpected external interface; no network control attempted")
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    if int(status["CapEff"].strip(), 16) or status["NoNewPrivs"].strip() != "1":
        raise RuntimeError("Effective capability/privilege boundary missing")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.socket.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
    libc.connect.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint]
    libc.sendto.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint]
    libc.sendto.restype = ctypes.c_ssize_t
    libc.close.argtypes = [ctypes.c_int]
    # TEST-NET-1 only, inside the already verified empty network namespace.
    address = ctypes.create_string_buffer(struct.pack("=H", 2) + struct.pack("!H", 9) + bytes([192, 0, 2, 1]) + bytes(8))
    network = []
    for name, kind in (("native_tcp_connect", 1), ("native_udp_sendto", 2)):
        fd = libc.socket(2, kind, 0)
        if fd < 0:
            raise RuntimeError("Native socket creation failed before relevant route control")
        try:
            ctypes.set_errno(0)
            result = libc.connect(fd, address, 16) if kind == 1 else libc.sendto(fd, b"control", 7, 0, address, 16)
            error = ctypes.get_errno()
            network.append({"operation": name, "result": result, "errno": error, "error": os.strerror(error)})
            if result != -1 or error != errno.ENETUNREACH:
                raise RuntimeError("Native network-none control did not yield ENETUNREACH")
        finally:
            libc.close(fd)
    if Path("/input/allowed.txt").read_text() != "task-owned technical input\n":
        raise RuntimeError("Allowed input unavailable")
    writes = []
    for name in ("/input/allowed.txt", "/code/control.py", "/etc/d07-control-forbidden"):
        try:
            with open(name, "a", encoding="utf-8") as out:
                out.write("forbidden\n")
        except OSError as error:
            writes.append({"path": name, "errno": error.errno, "denied": True})
            if error.errno not in (errno.EROFS, errno.EACCES):
                raise
        else:
            raise RuntimeError("Read-only write unexpectedly succeeded")
    forbidden = ["/run/desktop/mnt/host/e/BhuAayam-data/task-data/" + TASK + "/unmounted-canary.txt",
                 "/var/run/docker.sock", "/root/.aws/credentials", "/root/.docker/config.json"]
    unreachable = []
    for name in forbidden:
        try:
            with open(name, "rb") as source:
                source.read(1)
        except OSError as error:
            unreachable.append({"path": name, "errno": error.errno, "reachable": False})
        else:
            raise RuntimeError("Unexpected private/credential/socket reach")
    child = subprocess.Popen([sys.executable, "-B", "-I", "-c", "import time;time.sleep(30)"], stdin=subprocess.DEVNULL)
    child.terminate()
    child.wait(timeout=3)
    if child.poll() is None:
        raise RuntimeError("Owned child survived shutdown")
    cgroup = Path("/sys/fs/cgroup")
    effective = {name: (cgroup / name).read_text().strip() for name in
                 ("memory.max", "memory.swap.max", "memory.peak", "cpu.max", "cpuset.cpus.effective", "pids.max", "pids.peak")}
    if (effective["memory.max"], effective["memory.swap.max"], effective["cpu.max"], effective["cpuset.cpus.effective"], effective["pids.max"]) != (
        str(MEMORY), "0", "200000 100000", "0-1", "32"):
        raise RuntimeError("Effective cgroup limits differ from declaration")
    versions = {}
    for package in ("torch", "torchvision", "transformers", "pycocotools", "onnxruntime"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    result = {"status": "native_boundary_controls_passed", "python": sys.version, "uid": os.getuid(),
        "interfaces": interfaces, "networkNamespace": os.readlink("/proc/self/ns/net"), "nativeNetwork": network,
        "readOnlyWritesDenied": writes, "unmountedAndCredentialReachDenied": unreachable,
        "allowedInputRead": True, "allowedOutputWrite": True, "childExit": child.returncode,
        "childSurvived": False, "effectiveCgroup": effective,
        "peakSelfRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "installedMetadataOnly": versions, "torchImported": False, "modelsLoaded": 0, "gpuAssigned": False,
        "scope": "Control image/primitive only; matching Transformers training and GPU execution unqualified"}
    save("/output/control.json", result)
    print(json.dumps(result), flush=True)


def host():
    root = ROOT.resolve()
    if not root.is_dir():
        raise RuntimeError("Explicit owned private task directory required")
    save(root / "attempt.json", {"oneAttempt": True, "image": IMAGE})
    calls = []
    def command(args, timeout=30):
        start = time.perf_counter()
        proc = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
        calls.append({"argv": ["docker", *args], "exit": proc.returncode, "seconds": time.perf_counter() - start,
                      "stdout": proc.stdout[:65536], "stderr": proc.stderr[:16384]})
        if proc.returncode:
            raise RuntimeError("Docker command failed: " + proc.stderr[:2000])
        return proc.stdout
    def inventory():
        return {"containerIds": sorted(command(["ps", "-aq", "--no-trunc"]).splitlines()),
                "volumeNames": sorted(command(["volume", "ls", "-q"]).splitlines())}
    before = inventory()
    preflight = json.loads((root / "preflight.json").read_bytes())
    if before["containerIds"] != preflight["inventory"]["containerIds"] or before["volumeNames"] != preflight["inventory"]["volumeNames"]:
        raise RuntimeError("Retained resource inventory changed before owned launch")
    image = json.loads(command(["image", "inspect", IMAGE]))[0]
    if image["Id"] != IMAGE or image["Config"].get("Volumes"):
        raise RuntimeError("Pinned image identity/implicit volume drift")
    safe_env = {"PATH", "LANG", "GPG_KEY", "PYTHON_VERSION", "PYTHON_SHA256", "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED"}
    if {x.split("=", 1)[0] for x in image["Config"].get("Env", [])} - safe_env:
        raise RuntimeError("Unexpected image environment; refuse inherited secret/config scope")
    for directory in ("code", "input", "output"):
        (root / directory).mkdir()
    (root / "code/control.py").write_bytes(Path(__file__).read_bytes())
    (root / "input/allowed.txt").write_text("task-owned technical input\n", encoding="utf-8", newline="\n")
    (root / "unmounted-canary.txt").write_text("technical canary excluded from mounts\n", encoding="utf-8")
    originals = [pin(root / "code/control.py"), pin(root / "input/allowed.txt"), pin(root / "unmounted-canary.txt")]
    name = TASK + "-" + uuid.uuid4().hex[:12]
    create = ["create", "--pull=never", "--name", name, "--label", "codex.task=" + TASK,
        "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--user=10001:10001", "--init", "--ipc=private", "--pids-limit=32", "--cpus=2", "--cpuset-cpus=0,1",
        "--memory=5g", "--memory-swap=5g", "--shm-size=16m", "--tmpfs=/tmp:rw,noexec,nosuid,size=16m",
        "--env=HOME=/tmp", "--env=HF_HUB_OFFLINE=1", "--env=TRANSFORMERS_OFFLINE=1", "--env=CUDA_VISIBLE_DEVICES=",
        "--env=OMP_NUM_THREADS=2", "--env=MKL_NUM_THREADS=2", "--env=OPENBLAS_NUM_THREADS=2",
        "--entrypoint=/usr/local/bin/python"]
    for directory, readonly in (("code", True), ("input", True), ("output", False)):
        mount = "type=bind,source=" + str(root / directory) + ",target=/" + directory
        create.extend(["--mount", mount + (",readonly" if readonly else "")])
    create.extend([IMAGE, "-B", "-I", "/code/control.py", "--probe-worker"])
    save(root / "launch-profile.json", {"image": IMAGE, "command": ["docker", *create], "inputPins": originals,
        "deadlineSeconds": 120, "noGpu": True, "nativeModelCalls": 0, "futureTrainingCompatible": False})
    cid = None
    failure = None
    inspection = None
    try:
        cid = command(create).strip()
        inspected = json.loads(command(["inspect", cid]))[0]
        config = inspected["HostConfig"]
        if (config["NetworkMode"], config["ReadonlyRootfs"], config["Memory"], config["MemorySwap"], config["NanoCpus"], config["PidsLimit"]) != (
            "none", True, MEMORY, MEMORY, 2_000_000_000, 32):
            raise RuntimeError("Container declaration failed readback before start")
        if inspected["Config"]["Labels"].get("codex.task") != TASK or inspected["Config"]["User"] != "10001:10001":
            raise RuntimeError("Owned label/non-root identity mismatch")
        if {(m["Destination"], m["RW"]) for m in inspected["Mounts"]} != {("/code", False), ("/input", False), ("/output", True)}:
            raise RuntimeError("Unassigned mount scope")
        inspection = {"id": cid, "requestedImage": inspected["Config"]["Image"], "imageConfigId": inspected["Image"],
            "hostConfig": {k: config[k] for k in ("NetworkMode", "ReadonlyRootfs", "CapDrop", "SecurityOpt", "Memory", "MemorySwap", "NanoCpus", "CpusetCpus", "PidsLimit", "DeviceRequests", "IpcMode")},
            "mounts": inspected["Mounts"], "envNames": [x.split("=", 1)[0] for x in inspected["Config"].get("Env", [])]}
        command(["start", "--attach", cid], timeout=120)
        state = json.loads(command(["inspect", "--format", "{{json .State}}", cid]))
        if state["ExitCode"] or state["Running"] or state["OOMKilled"]:
            raise RuntimeError("Worker exit/resource state rejected")
        if not (root / "output/control.json").is_file():
            raise RuntimeError("Missing actual native/access control output")
    except Exception as error:
        failure = {"type": type(error).__name__, "message": str(error)}
    finally:
        if cid:
            current = json.loads(command(["inspect", cid]))[0]
            if current["Id"] != cid or current["Config"]["Labels"].get("codex.task") != TASK:
                raise RuntimeError("Cleanup identity mismatch; refuse unrelated removal")
            command(["rm", "--force", cid])
    after = inventory()
    if after != before:
        failure = failure or {"type": "InventoryMismatch", "message": "Original container IDs/volumes changed"}
    for entry in originals:
        if pin(entry["path"]) != entry:
            failure = failure or {"type": "InputChanged", "message": entry["path"]}
    save(root / "host-receipt.json", {"status": "failed" if failure else "control_boundary_passed_training_runtime_blocked",
        "failure": failure, "inspection": inspection, "calls": calls, "before": before, "after": after,
        "ownedContainerRemoved": bool(cid), "workerOutput": pin(root / "output/control.json") if (root / "output/control.json").exists() else None,
        "modelLoads": 0, "gpuUse": False, "noSharedProfilesOrAclChanges": True})
    print(json.dumps({"failure": failure, "ownedContainerRemoved": bool(cid), "oldContainersPreserved": len(after["containerIds"]), "oldVolumesPreserved": len(after["volumeNames"])}))
    if failure:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe-worker", action="store_true")
    args = parser.parse_args()
    worker() if args.probe_worker else host()
