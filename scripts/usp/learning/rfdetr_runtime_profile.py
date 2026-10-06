"""Prepare a sealed RF-DETR profile; separately authorized bounded checks only.

Metadata readiness is separate from actual runtime, model, GPU and fit admission.
The historical authorization admits CPU processor and tiny GPU controls.
A separate exact root instruction admits the frozen Torch reference, with
current-process gates and conditional ALL24. Separately authorized v2 is an
own-route ALL24 baseline with cached production scoring. A distinct exact root
instruction admits one frozen pilot fit with no evaluation or scoring.
A separate positive/empty loss probe admits at most two no-grad forwards,
without Trainer, backward, optimizer or checkpoint writes.
The e71d historical control and its single-use launcher remain unchanged.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
import os
import queue
import runpy
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path, PurePosixPath

TASK = "d07-rfdetr-runtime-profile-20261005"
DATA = Path("E:/BhuAayam-data/task-data")
MOUNTED = DATA / "d07-rfdetr-mounted-plan-20261005"
BASE = DATA / "d07-rfdetr-gpu-base-20261005"
OUT = DATA / TASK
INTERFACE = (MOUNTED / "launch-interface-runtime-v1.json", 51011,
             "eaeb7e13580fb3a43f7079e11626e815e8dde60b537bcd6b6cd6225aa0f3194c")
CONFIG = (MOUNTED / "mounted-config-runtime-v1.json", 52751,
          "14d3936c88b983a5838f027bc411c9a656804de6b301f8e5be6d1aa6a87cf367")
PLAN = (MOUNTED / "mounted-plan-runtime-v1.json", 26107,
        "14343270b4511007b6d0bdbcfb6b4f473f4f60b20d5ee49f95b971af7fcdb9ac")
BINDING = (BASE / "runtime-binding.json", 6417,
           "6f801e596890067be2bf61b673958645c378480db6203dba277243f4427ef615")
AUTH_SHA = "f5b7f021b993025911b0f581114c3334f144dd49c76a7deadba60c402a773816"
GPU_UUID = "GPU-3989f368-bd26-bd52-9daf-037a9862f82f"
REF = DATA / "d07-rfdetr-torch-reference-20261005"
REF_RUN = DATA / "d07-rfdetr-torch-reference-run-20261005"
REF_ROOT_SHA = "2c64ac673da0ce97f9f2b3c6cff460f592a8196690fb68c7c8a3e171077e4298"
REF_RUNNER_SHA = "cb771a12ac46ee4ae448bd90ce42574676d9a6afc28ac147aa1cd9e98212e0a1"
REF_INTERFACE_SHA = "dca3b54f2ca7401cf2b3a02656d845a6985b023d79db309b4cbfe2a9d754c993"
REF_PLANS = {"smoke": "c971142103a4dc19c4165a0f051664df8856013e5699565b4349030af4e96e20",
             "development": "88a3b33c742044c19d868d31b3d19a362b65c7e113899f1367b89a22f71fdfca"}
BL_PREP = DATA / "d07-rfdetr-torch-baseline-20261005/prepared-v2"
BL_RUN = DATA / "d07-rfdetr-torch-baseline-run-20261005"
BL_ROOT_SHA = "f453d00a279c07e9f43315b195cd18c4e59e709addc94ce3c3d556a1e2e54ada"
BL_RUNNER_SHA = "7882a3bf3ff99076add9f551c1b5881a52fba1c98bbe553bf125768cd0d84db1"
BL_PLAN_SHA = "d350f2f0fa943423150e20ed77cd3d0fcc7558a4213456bb2b321d4bd384a3b0"
BL_INTERFACE_SHA = "2c37c0e547f1d0724d0525bc3103e1edbc7ca3bff7137a106fa94000968ec3f6"
FIT_PREP = DATA / "d07-rfdetr-pilot-fit-20261005"
FIT_RUN = DATA / "d07-rfdetr-pilot-fit-run-20261005"
FIT_ROOT_SHA = "71f0091f70ede5c5b8db1729ac368e626c79e7cb8f97d8594e74bbc7e7a9b3ef"
FIT_RUNNER_SHA = "30dfc02ab1f7d4122e306cdd7ca4ac3262b8e30791f2c77b8098527fb8880c93"
FIT_PLAN_SHA = "22b0a1bd318490bb3a5b484dd248eebdba9d94c87879897f1c3d2de60f7abe37"
FIT_INTERFACE_SHA = "5f26294968f4af554dd6419dde4bdd020321b0bd3eade07c55a9086d9355b29e"
REPAIRED_PREP = DATA / "d07-rfdetr-repaired-pilot-20261006"
REPAIRED_RUN = REPAIRED_PREP / "launcher"
REPAIRED_RUNNER_SHA = "718740ff8b0fe5bbf403873c854c07d9811e1551a148aef1f5581d16e8a8eccd"
REPAIRED_PLAN_SHA = "03d7ebad4b4b75643c2bca894a5472ad37a4e4277168a0730a4c4c6c123c4293"
REPAIRED_CANONICAL_SHA = "c5fc1577fde353a92652d12913b54a4c0a9a838dd563c2a49965660c8246134d"
REPAIRED_INTERFACE_SHA = "e4da828972aac67aeffd0583077ad9609079d31b9273ec4c7c9c1e3f1ee64836"
REPAIRED_TASK = "D07-RFDETR-REPAIRED-PILOT-FIT-EXECUTE"
REPAIRED_SCOPE = "one_fixed_repaired_pilot_fit_no_evaluation"
PROBE = DATA / "d07-rfdetr-empty-loss-probe-20261006"
DIAGNOSIS = DATA / "d07-rfdetr-nonfinite-diagnosis-20261006"
PROBE_ROOT_SHA = "2e42045ae78021a92a5bc7ee47456933f597396eea75581bb60cc9c1b1e9aa41"
PROBE_RUNNER_SHA = "24afe260cb2c19fd6a56c5cfdd7b88d40a3df6af03b08f073fee20fb061deafd"
PROBE_PROPOSAL_SHA = "6dc4ffde6a8b3b6e00ba67000d3c592c01848ae5953fee81fcf0b10a6ef98be2"
PROBE_SCOPE = {"task":"D07-RFDETR-EMPTY-LOSS-PROBE", "scope":"original_positive_empty_loss_only",
    "forwardWithBuiltInLossMax":2, "backward":0, "optimizer":0, "fitEpochs":0,
    "developmentExamples":0, "finalExamples":0, "selectedImageIds":[1,13]}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def host_path(value, kind=None, exists=True):
    path = Path(value)
    require(path.is_absolute(), "Host path must be absolute")
    for node in [path, *path.parents]:
        require(not node.is_symlink() and not node.is_junction(), "Link/junction input refused")
    require(path.resolve(strict=exists) == path, "Noncanonical/escaping host path refused")
    if kind:
        require(path.is_file() if kind == "file" else path.is_dir(), "Input kind mismatch")
    return path


def container_path(value):
    path = PurePosixPath(value)
    require(path.is_absolute() and str(path) == value and ".." not in path.parts,
            "Noncanonical/escaping container path refused")
    return path


def pin(value):
    path = host_path(value, "file")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def checked_json(seal):
    path, size, sha = seal
    actual = pin(path)
    require((actual["bytes"], actual["sha256"]) == (size, sha), "Sealed metadata pin mismatch")
    return json.loads(path.read_bytes())


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(value, out, indent=2, allow_nan=False)
        out.write("\n")


# Pinned inline code avoids adding a broad code/checkout mount. It is compiled,
# not executed, in this metadata task. A later assignment must validate Docker
# readback before starting this exact CPU-only native-control process.
CONTROL = r'''
import ctypes, errno, hashlib, importlib.metadata, json, os, resource, struct, subprocess, sys
from pathlib import Path
def need(value, message):
    if not value: raise RuntimeError(message)
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for part in iter(lambda:f.read(1048576),b''): h.update(part)
    return h.hexdigest()
config=Path('/inputs/plan/mounted-config.json')
need(config.stat().st_size==52751 and digest(config)=='14d3936c88b983a5838f027bc411c9a656804de6b301f8e5be6d1aa6a87cf367','Mounted config pin mismatch')
cfg=json.loads(config.read_bytes())
need(sys.platform=='linux' and os.getuid()==10001,'Wrong Linux/non-root identity')
need(sorted(p.name for p in Path('/sys/class/net').iterdir())==['lo'],'External interface; native probe refused')
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
need(int(status['CapEff'].strip(),16)==0 and status['NoNewPrivs'].strip()=='1','Privilege boundary missing')
need(os.statvfs('/').f_flag & os.ST_RDONLY,'Writable rootfs')
need(not list(Path('/dev').glob('nvidia*')) and not Path('/dev/dxg').exists(),'Unexpected GPU devices in CPU profile')
for mount in cfg['mounts']:
    need(os.statvfs(mount['containerPath']).f_flag & os.ST_RDONLY,'Writable input mount')
need(os.statvfs(config).f_flag & os.ST_RDONLY,'Writable config mount')
output=Path('/outputs/rfdetr')
need(not (os.statvfs(output).f_flag & os.ST_RDONLY),'Task output is read-only')
for item in cfg['inventory']:
    expected=item['containerPin']; path=Path(expected['path'])
    need(not path.is_symlink() and path.resolve()==path,'Escaping input')
    need(path.stat().st_size==expected['bytes'] and digest(path)==expected['sha256'],'Input pin mismatch')
versions={k:importlib.metadata.version(k) for k in cfg['runtimeBinding']['packageVersions']}
need(versions==cfg['runtimeBinding']['packageVersions'],'Actual package metadata mismatch')
need(sys.version.split()[0]==cfg['runtimeBinding']['pythonVersion'],'Actual Python mismatch')
libc=ctypes.CDLL(None,use_errno=True)
libc.socket.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_int]
libc.connect.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint]
libc.sendto.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint]
libc.sendto.restype=ctypes.c_ssize_t
libc.close.argtypes=[ctypes.c_int]
addr=ctypes.create_string_buffer(struct.pack('=H',2)+struct.pack('!H',9)+bytes([192,0,2,1])+bytes(8))
network=[]
for label,kind in [('native_tcp_connect',1),('native_udp_sendto',2)]:
    fd=libc.socket(2,kind,0); need(fd>=0,'Native socket creation failed')
    try:
        ctypes.set_errno(0)
        result=libc.connect(fd,addr,16) if kind==1 else libc.sendto(fd,b'control',7,0,addr,16)
        error=ctypes.get_errno()
        need(result==-1 and error==errno.ENETUNREACH,'Native egress control failed')
        network.append({'operation':label,'result':result,'errno':error})
    finally: libc.close(fd)
denied=[]
for name in ['/inputs/model/config.json','/inputs/plan/train_building_ramp.py',str(config),'/etc/d07-control-forbidden']:
    try:
        # Open without truncating/appending; an unexpected success changes no bytes.
        flags=os.O_WRONLY
        if name=='/etc/d07-control-forbidden': flags|=os.O_CREAT|os.O_EXCL
        fd=os.open(name,flags,0o600); os.close(fd)
    except OSError as error:
        need(error.errno in [errno.EROFS,errno.EACCES],'Unexpected write refusal')
        denied.append({'path':name,'errno':error.errno})
    else: raise RuntimeError('Input/root write access unexpectedly allowed')
unreachable=[]
for name in ['/var/run/docker.sock','/root/.aws/credentials','/root/.docker/config.json','/run/desktop/mnt/host/e/BhuAayam-data/task-data/d07-rfdetr-containment-20261005/unmounted-canary.txt']:
    try:
        with open(name,'rb') as f: f.read(1)
    except OSError as error:
        need(error.errno in [errno.ENOENT,errno.EACCES],'Unexpected reach refusal')
        unreachable.append({'path':name,'errno':error.errno})
    else: raise RuntimeError('Unexpected unmounted/private reach')
child=subprocess.Popen([sys.executable,'-I','-B','-c','import time;time.sleep(30)'],stdin=subprocess.DEVNULL)
try:
    child.terminate(); child.wait(timeout=3)
finally:
    if child.poll() is None: child.kill(); child.wait(timeout=3)
need(child.poll() is not None,'Owned child survived')
cg=Path('/sys/fs/cgroup')
limits={k:(cg/k).read_text().strip() for k in ['memory.max','memory.swap.max','cpu.max','cpuset.cpus.effective','pids.max','memory.peak','pids.peak']}
need(all(limits[k]==v for k,v in {'memory.max':'5368709120','memory.swap.max':'0','cpu.max':'200000 100000','cpuset.cpus.effective':'0-1','pids.max':'32'}.items()),'Actual resource limits mismatch')
result={'status':'actual_cpu_native_control_passed','network':network,'inputPinsChecked':len(cfg['inventory'])+1,'readOnlyWritesDenied':denied,'unmountedReachDenied':unreachable,'packageVersions':versions,'python':sys.version,'uid':os.getuid(),'networkNamespace':os.readlink('/proc/self/ns/net'),'childExit':child.returncode,'childSurvived':False,'limits':limits,'peakSelfRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,'modelsLoaded':0,'torchImported':False,'gpuAssigned':False,'trainingAuthorized':False}
with (output/'native-control.json').open('x',encoding='utf-8') as f: json.dump(result,f,indent=2); f.write('\n')
print(json.dumps({'status':result['status'],'inputPinsChecked':result['inputPinsChecked']}))
'''.lstrip()


def sealed_inputs(validate_old_output=True):
    interface, cfg, plan, binding = map(checked_json, (INTERFACE, CONFIG, PLAN, BINDING))
    require(interface["executionAuthorized"] is False and cfg["trainingAuthorized"] is False
            and plan["trainingAuthorized"] is False and cfg["fitAdmission"] == "not_fit_admitted",
            "Metadata cannot grant execution or fit admission")
    mounts = interface["mounts"]
    require(len(mounts) == 18 and len(interface["inventory"]) == 67, "Finite interface denominator mismatch")
    require(cfg["mounts"] == mounts[:-1] and cfg["inventory"] == interface["inventory"], "Config/interface input mismatch")
    require(cfg["output"] == interface["output"], "Output binding mismatch")
    required = [*interface["inventory"], {"hostPin": mounts[-1]["pin"],
        "containerPin": {**mounts[-1]["pin"], "path": mounts[-1]["containerPath"]}}]
    seen_host, seen_container = set(), set()
    all_mounts = [*mounts, interface["output"]]
    for index, mount in enumerate(all_mounts):
        require(mount["readOnly"] is (index < 18), "Unknown/writable input mount refused")
        hp = host_path(mount["hostPath"], mount["kind"] if index < 18 else None, exists=index < 18)
        cp = container_path(mount["containerPath"])
        for other in all_mounts[:index]:
            oh, oc = Path(other["hostPath"]), PurePosixPath(other["containerPath"])
            require(not (hp.is_relative_to(oh) or oh.is_relative_to(hp)
                         or cp.is_relative_to(oc) or oc.is_relative_to(cp)), "Overlapping mounts refused")
    for item in required:
        hp, cp = item["hostPin"], item["containerPin"]
        path, target = host_path(hp["path"], "file"), container_path(cp["path"])
        matches = [m for m in mounts if path == Path(m["hostPath"])
                   or (m["kind"] == "directory" and path.is_relative_to(Path(m["hostPath"])))]
        require(len(matches) == 1, "Unselected input or ambiguous input mount")
        mount = matches[0]
        relative = path.relative_to(Path(mount["hostPath"]))
        mapped = PurePosixPath(mount["containerPath"])
        if mount["kind"] == "directory":
            mapped /= relative.as_posix()
        require(target == mapped, "Input mapping mismatch")
        require((hp["bytes"], hp["sha256"]) == (cp["bytes"], cp["sha256"]), "Host/container pin mismatch")
        require(path not in seen_host and target not in seen_container, "Duplicate input refused")
        seen_host.add(path); seen_container.add(target)
        actual = pin(path)
        require((actual["bytes"], actual["sha256"]) == (hp["bytes"], hp["sha256"]), "Input bytes changed")
    for mount in mounts:
        if mount["kind"] == "directory":
            paths = set()
            for path in Path(mount["hostPath"]).rglob("*"):
                host_path(path)
                require(path.is_file(), "Unexpected input subdirectory refused")
                paths.add(path)
            require(paths == {p for p in seen_host if p.is_relative_to(Path(mount["hostPath"]))},
                    "Unpinned file in mounted directory refused")
    output = Path(interface["output"]["hostPath"])
    if validate_old_output:
        require(not output.exists() or (output.is_dir() and not any(output.iterdir())), "Output must be a new empty task directory")
    role_paths = {m["role"]: m["hostPath"] for m in mounts}
    runtime_files = {}
    for key, role in [("packageLock", "packageLock"), ("installedMetadata", "installedMetadata"), ("imageMetadata", "imageMetadata")]:
        runtime_files[key] = json.loads(Path(role_paths[role]).read_bytes())
        actual, bound = pin(role_paths[role]), binding[key]
        require(Path(actual["path"]) == Path(bound["path"])
                and (actual["bytes"], actual["sha256"]) == (bound["bytes"], bound["sha256"]),
                "Runtime sidecar binding mismatch")
    lock, metadata, image = (runtime_files[k] for k in ("packageLock", "installedMetadata", "imageMetadata"))
    require(lock["installedPackageVersions"] == metadata["installedPackageVersions"] == binding["packageVersions"],
            "Complete installed-version lock mismatch")
    require(lock["python"] == binding["pythonVersion"] and lock["platform"] == binding["platform"], "Runtime platform/Python mismatch")
    require(image["Id"] == binding["imageDigest"] and image["Descriptor"]["annotations"]["config.digest"] == binding["imageConfigDigest"], "Actual image/config digest mismatch")
    require(image["Os"] + "/" + image["Architecture"] == binding["platform"] == "linux/amd64", "Unsupported runtime platform")
    require(image["Config"]["User"] == binding["imageUser"] == "10001:10001"
            and image["Config"]["Entrypoint"] == binding["imageEntrypoint"] == [binding["pythonExecutable"]]
            and image["Config"]["Env"] == binding["imageEnvironment"] and not image["Config"].get("Volumes"), "Image configuration mismatch")
    adapted = copy.deepcopy(binding)
    for key in ("packageLock", "installedMetadata", "imageMetadata"):
        adapted[key]["path"] = next(m["containerPath"] for m in mounts if m["role"] == key)
    adapted["receipt"] = {**pin(BINDING[0]), "path": "/inputs/plan/runtime-binding.json"}
    adapted["rootfsLayerDiffIds"] = image["RootFS"]["Layers"]
    require(interface["runtimeBinding"] == cfg["runtimeBinding"] == plan["runtimeBinding"] == adapted,
            "Mounted runtime binding mismatch")
    require(plan["expectedPackageVersions"] == binding["packageVersions"], "Plan version gate mismatch")
    require(plan["classMapping"]["cocoCategory1"] == "rooftop_building" and plan["classMapping"]["modelLabel0"] == "building", "Class mapping changed")
    return interface, cfg, binding


def profile(validate_old_output=True, repaired_metadata=None):
    if repaired_metadata is None:
        interface, cfg, binding = sealed_inputs(validate_old_output)
    else:
        # The repaired route must not hash/read the old development data pool.
        repaired_interface, cfg = repaired_metadata
        interface = checked_json(INTERFACE)
        interface.update(mounts=repaired_interface["allReadOnlyMounts"], output=repaired_interface["writableOutput"])
        binding = checked_json(BINDING)
        require(cfg["runtimeBinding"]["imageDigest"] == binding["imageDigest"]
                and cfg["runtimeBinding"]["packageVersions"] == binding["packageVersions"], "Repaired runtime binding drift")
    compile(CONTROL, "<rfdetr-native-control>", "exec")
    environment = dict(x.split("=", 1) for x in binding["imageEnvironment"])
    overrides = {**interface["environmentOverrides"], "HOME": "/tmp", "CUDA_VISIBLE_DEVICES": ""}
    require(overrides["NVIDIA_VISIBLE_DEVICES"] == "void" and interface["deviceRequests"] == []
            and interface["gpuAssigned"] is False, "GPU assignment refused in CPU control profile")
    environment.update(overrides)
    policy = {"network": "none", "readOnlyRootfs": True, "capDrop": ["ALL"],
        "securityOpt": ["no-new-privileges"], "user": "10001:10001", "init": True,
        "ipc": "private", "memoryBytes": 5368709120, "memorySwapBytes": 5368709120,
        "hostJobMemoryBytes": 536870912, "cpus": 2, "cpuset": "0,1", "pids": 32,
        "tmpfs": {"/tmp": "rw,noexec,nosuid,size=16m"}, "shmBytes": 16777216,
        "deviceRequests": [], "attachDeadlineSeconds": 120, "supervisorDeadlineSeconds": 300}
    args = ["docker", "--context", "desktop-linux", "create", "--pull=never", "--platform=linux/amd64", "--name", TASK + "-pending-control",
        "--label", "codex.task=" + TASK, "--network=none", "--read-only", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--user=10001:10001", "--init", "--ipc=private",
        "--pids-limit=32", "--cpus=2", "--cpuset-cpus=0,1", "--memory=5g", "--memory-swap=5g",
        "--shm-size=16m", "--tmpfs=/tmp:rw,noexec,nosuid,size=16m", "--workdir=/inputs/plan",
        "--entrypoint=" + binding["pythonExecutable"]]
    for key, value in sorted(overrides.items()):
        args.extend(["--env", key + "=" + value])
    for mount in [*interface["mounts"], interface["output"]]:
        args.extend(["--mount", "type=bind,source=" + mount["hostPath"] + ",target=" + mount["containerPath"]
                     + (",readonly" if mount["readOnly"] else "")])
    args.extend([binding["imageDigest"], "-I", "-B", "-c", CONTROL])
    return {"schemaVersion": "rfdetr-native-control-profile/1", "task": TASK,
        "state": "prepared_metadata_only_execution_disabled", "rootAuthorization": None,
        "dockerContext": "desktop-linux",
        "runtimeBindingPin": pin(BINDING[0]), "interfacePin": pin(REPAIRED_PREP / "interface.json") if repaired_metadata is not None else pin(INTERFACE[0]),
        "mountedConfigPin": pin(REPAIRED_PREP / "plan.json") if repaired_metadata is not None else pin(CONFIG[0]),
        "mountedPlanPin": pin(REPAIRED_PREP / "plan.json") if repaired_metadata is not None else pin(PLAN[0]),
        "imageDigest": binding["imageDigest"], "imageConfigDigest": binding["imageConfigDigest"],
        "python": binding["pythonExecutable"], "packageVersions": binding["packageVersions"],
        "mounts": interface["mounts"], "output": interface["output"], "inventoryFiles": len(cfg["inventory"]) + 1 if repaired_metadata is not None else 68,
        "policy": policy, "environment": environment, "environmentOverrides": overrides,
        "controlCodeSha256": hashlib.sha256(CONTROL.encode()).hexdigest(), "createArgv": args,
        "adapterPlanOnlyArgv": [binding["pythonExecutable"], *interface["argv"]],
        "requiredBeforeStart": ["Separate root actual-runtime assignment", "Exact image/config/environment/mount/device/resource readback", "Fresh single-attempt marker/output and gated host Job"],
        "cleanup": {"exactCreatedIdAndTaskLabelOnly": True, "terminateReapChild": True,
                    "removeOwnedContainer": True, "closeHostJob": True, "retainedIdsVolumesEqual": True},
        "trainingAuthorized": False, "modelsLoaded": 0, "gpuAssigned": False,
        "historicalControl": {"image": "sha256:e71d87961be773c18685622eb570c034cf664bfa206e21f6fa3691d629b440c9", "scope": "Historical three-mount primitive only"}}


def validate_candidate(candidate, expected):
    require(candidate.get("mounts") == expected["mounts"] and candidate.get("output") == expected["output"],
            "Finite mount allowlist mismatch; unknown/writable/escaping/overlapping mount refused")
    require(candidate == expected, "Profile, authorization or runtime binding differs from sealed metadata")


def validate_inspection(actual, expected):
    """Validate one future Docker readback; this function never invokes Docker."""
    config, host = actual["Config"], actual["HostConfig"]
    require(actual["Image"] == expected["imageDigest"]
            and config["Image"] == expected["imageDigest"], "Actual selected image mismatch")
    require(config["User"] == "10001:10001" and config["WorkingDir"] == "/inputs/plan"
            and config["Entrypoint"] == [expected["python"]]
            and config["Cmd"] == expected.get("processArgv", expected["createArgv"][-4:])
            and config["Labels"].get("codex.task") == expected["task"], "Actual task/entrypoint binding mismatch")
    env = dict(x.split("=", 1) for x in config["Env"])
    require(len(env) == len(config["Env"]) and env == expected["environment"], "Actual environment differs from finite binding")
    desired = {(str(Path(m["hostPath"])), m["containerPath"], not m["readOnly"])
               for m in [*expected["mounts"], expected["output"]]}
    observed = {(str(Path(m["Source"])), m["Destination"], m["RW"]) for m in actual["Mounts"]}
    require(len(actual["Mounts"]) == len(desired) and observed == desired
            and all(m["Type"] == "bind" for m in actual["Mounts"]), "Actual mount allowlist mismatch")
    values = {"NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
              "Memory": 5368709120, "MemorySwap": 5368709120, "NanoCpus": 2000000000,
              "CpusetCpus": "0,1", "PidsLimit": 32, "IpcMode": "private", "Init": True,
              "ShmSize": 16777216}
    require(all(host.get(k) == v for k, v in values.items()), "Actual resource/isolation binding mismatch")
    devices = host.get("DeviceRequests") or []
    if expected["gpuAssigned"]:
        require(len(devices) == 1 and devices[0]["DeviceIDs"] == [GPU_UUID]
                and devices[0]["Count"] == 0 and devices[0]["Capabilities"] == [["gpu"]]
                and devices[0]["Driver"] in ("", "nvidia") and not devices[0].get("Options"),
                "Actual GPU must be scoped to the single authorized UUID")
    else:
        require(not devices, "Unexpected CPU GPU request")
    require(host.get("CapDrop") == ["ALL"] and not host.get("CapAdd")
            and host.get("SecurityOpt") == ["no-new-privileges"]
            and not host.get("Devices")
            and not host.get("PidMode") and not host.get("UTSMode")
            and host.get("Tmpfs") == expected["policy"]["tmpfs"], "Actual privilege/device/scratch binding mismatch")


CPU_EXTRA = r'''
import ast, time
started=time.perf_counter()
import torch, torchvision, transformers, numpy as np
from PIL import Image
from pycocotools import mask as coco_mask
from transformers import RfDetrImageProcessor
torch.set_num_threads(2); torch.set_num_interop_threads(1)
processor=RfDetrImageProcessor.from_pretrained('/inputs/model',local_files_only=True)
adapter=Path('/inputs/plan/train_building_ramp.py').read_text()
tree=ast.parse(adapter)
execution=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='execute')
loader=next(n for n in execution.body if isinstance(n,ast.ClassDef) and n.name=='CocoPool')
namespace={'Path':Path,'torch':torch,'np':np,'Image':Image,'coco_mask':coco_mask,'processor':processor,'read_json':lambda p:json.loads(Path(p).read_bytes()),'require':need}
exec(compile(ast.Module(body=[loader],type_ignores=[]),'/inputs/plan/train_building_ramp.py','exec'),namespace)
path=Path('/inputs/coco/train/_annotations.coco.json')
pool=namespace['CocoPool']({'annotationPin':{'path':str(path)}})
positive=sorted((i for i in range(len(pool)) if pool.annotations[pool.images[i]['id']]),key=lambda i:pool.images[i]['file_name'])[0]
empty=sorted((i for i in range(len(pool)) if not pool.annotations[pool.images[i]['id']]),key=lambda i:pool.images[i]['file_name'])[0]
cases=[]
for kind,index in [('positive',positive),('publisher_empty',empty)]:
    source=pool.images[index]; anns=pool.annotations[source['id']]
    need(all(a['category_id']==1 for a in anns),'Unexpected source category')
    item=pool[index]; pixels=item['pixel_values']; target=item['labels']; count=len(anns)
    need(list(pixels.shape)==[3,432,432] and not pixels.is_cuda and bool(torch.isfinite(pixels).all()),'Pixel shape/finiteness/device mismatch')
    need(list(target['class_labels'].shape)==[count] and bool((target['class_labels']==0).all()),'Category1-to-model0 mapping mismatch')
    need(list(target['boxes'].shape)==[count,4] and bool(torch.isfinite(target['boxes']).all()),'Target box shape/finiteness mismatch')
    need(list(target['masks'].shape)==[count,432,432] and target['masks'].dtype==torch.uint8,'Target mask shape mismatch')
    need((kind=='positive' and count>0) or (kind=='publisher_empty' and count==0),'Empty/positive source changed')
    cases.append({'kind':kind,'imageId':source['id'],'fileName':source['file_name'],'sourceInstances':count,'sourceCategory':1 if count else None,'modelCategory':0 if count else None,'pixelShape':list(pixels.shape),'boxShape':list(target['boxes'].shape),'classShape':list(target['class_labels'].shape),'maskShape':list(target['masks'].shape),'maskForegroundPixels':int(target['masks'].sum()),'emptyTargetsPreserved':count==0,'inputTargetTensorsOnly':True})
result={'status':'cpu_processor_controls_passed','packages':{'torch':torch.__version__,'torchvision':torchvision.__version__,'transformers':transformers.__version__,'pycocotools':importlib.metadata.version('pycocotools')},'processorClass':type(processor).__name__,'processorLocalOnly':True,'loaderSourceSha256':hashlib.sha256(ast.get_source_segment(adapter,loader).encode()).hexdigest(),'cases':cases,'elapsedSeconds':time.perf_counter()-started,'memoryPeakBytes':int((Path('/sys/fs/cgroup')/'memory.peak').read_text()),'pidsPeak':int((Path('/sys/fs/cgroup')/'pids.peak').read_text()),'modelWeightsLoaded':False,'modelParametersCreated':0,'inferenceCalls':0,'lossOrTrainerOrOptimizerCalls':0,'gpuTensorCalls':0,'trainingAuthorized':False}
with (output/'processor-control.json').open('x',encoding='utf-8') as f: json.dump(result,f,indent=2); f.write('\n')
print(json.dumps(result),flush=True)
'''.lstrip()

GPU_EXTRA = r'''
import time
started=time.perf_counter()
import torch
torch.set_num_threads(2);torch.set_num_interop_threads(1)
need(torch.cuda.is_available() and torch.cuda.device_count()==1,'Expected exactly one available CUDA device')
props=torch.cuda.get_device_properties(0)
need('RTX 3070' in props.name,'Wrong GPU model')
torch.cuda.reset_peak_memory_stats()
with torch.no_grad():
    tiny=torch.ones((256,256),device='cuda',dtype=torch.float32)
    value=(tiny*2).sum().item()
torch.cuda.synchronize()
need(value==131072.0,'Tiny finite tensor result mismatch')
peak=torch.cuda.max_memory_allocated();reserved=torch.cuda.max_memory_reserved()
need(0<peak<=64*1024**2 and reserved<=64*1024**2,'GPU allocation cap exceeded')
del tiny
torch.cuda.empty_cache()
result={'status':'tiny_gpu_control_passed','torch':torch.__version__,'compiledCuda':torch.version.cuda,'visibleDeviceCount':torch.cuda.device_count(),'gpuName':props.name,'deviceUuid':str(getattr(props,'uuid','unavailable')),'totalMemoryBytes':props.total_memory,'capability':[props.major,props.minor],'operation':'ones256x256_float32_times2_sum','result':value,'peakAllocatedBytes':peak,'peakReservedBytes':reserved,'finalAllocatedBytes':torch.cuda.memory_allocated(),'elapsedSeconds':time.perf_counter()-started,'cgroupMemoryPeakBytes':int((Path('/sys/fs/cgroup')/'memory.peak').read_text()),'modelsLoaded':0,'inferenceCalls':0,'trainingAuthorized':False}
with (output/'gpu-smoke.json').open('x',encoding='utf-8') as f: json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result),flush=True)
'''.lstrip()


def actual_checks(authorization, runtime_binding):
    require(authorization == OUT / "actual-authorization.json"
            and pin(authorization)["sha256"] == AUTH_SHA, "Exact delegated authorization binding required")
    require(pin(runtime_binding) == pin(BINDING[0]), "Execution runtime binding mismatch")
    require(json.loads(authorization.read_bytes())["trainingAuthorized"] is False, "Fit authorization refused")
    save(OUT / "actual-attempt.json", {"cpuAttempts": 1, "gpuAttemptsIfCpuPasses": 1, "authorizationSha256": AUTH_SHA})
    expected = profile()
    calls, phases = [], []
    def command(args, timeout=20):
        started = time.perf_counter()
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        calls.append({"argv": args, "exitCode": proc.returncode, "elapsedSeconds": time.perf_counter()-started,
                      "stdout": proc.stdout[:65536], "stderr": proc.stderr[:16384]})
        require(proc.returncode == 0, "Docker command failed: " + proc.stderr[:4000])
        require(len(proc.stdout) <= 65536 and len(proc.stderr) <= 16384, "Command log cap exceeded")
        return proc.stdout
    docker = ["docker", "--context", "desktop-linux"]
    def inventory():
        return {"containers": sorted(command([*docker, "ps", "-aq", "--no-trunc"]).splitlines()),
                "volumes": sorted(command([*docker, "volume", "ls", "-q"]).splitlines())}
    before = inventory()
    saved = json.loads((OUT / "actual-preflight.json").read_bytes())
    require(before == {k:saved[k] for k in ("containers", "volumes")}, "Preflight inventory changed")
    image = json.loads(command([*docker, "image", "inspect", expected["imageDigest"]]))[0]
    retained = json.loads((BASE / "layer-image-inspect.json").read_bytes())
    require(all(image[k] == retained[k] for k in ("Id", "Config", "RootFS", "Os", "Architecture", "Descriptor")), "Actual image metadata changed")
    save(OUT / "actual-image-readback.json", image)
    output = Path(expected["output"]["hostPath"])
    output.mkdir(exist_ok=True)
    failure = None
    try:
        for phase, deadline in (("cpu", 300), ("gpu", 120)):
            selected = copy.deepcopy(expected)
            selected["rootAuthorization"] = pin(authorization)
            selected["state"] = "separately_authorized_actual_control_only"
            if phase == "cpu":
                source = CONTROL + CPU_EXTRA
            else:
                source = CONTROL.replace("need(not list(Path('/dev').glob('nvidia*')) and not Path('/dev/dxg').exists(),'Unexpected GPU devices in CPU profile')", "# Device exposure is checked by exact UUID readback and Torch below.")
                source = source.replace("native-control.json", "gpu-native-control.json").replace("'gpuAssigned':False", "'gpuAssigned':True") + GPU_EXTRA
                source = source.replace("actual_cpu_native_control_passed", "actual_gpu_native_control_passed")
                selected["gpuAssigned"] = True
                selected["policy"]["deviceRequests"] = [{"DeviceIDs": [GPU_UUID], "Count": 0, "Capabilities": [["gpu"]]}]
                selected["environmentOverrides"].update(NVIDIA_VISIBLE_DEVICES=GPU_UUID, CUDA_VISIBLE_DEVICES="0")
                selected["environment"].update(NVIDIA_VISIBLE_DEVICES=GPU_UUID, CUDA_VISIBLE_DEVICES="0")
            compile(source, "<actual-rfdetr-" + phase + ">", "exec")
            args = selected["createArgv"]
            args[args.index("--name") + 1] = TASK + "-" + phase + "-" + uuid.uuid4().hex[:12]
            if phase == "gpu":
                args[args.index(expected["imageDigest"]):args.index(expected["imageDigest"])] = ["--gpus", "device=" + GPU_UUID]
                for index, value in enumerate(args):
                    if value.startswith("NVIDIA_VISIBLE_DEVICES="): args[index] = "NVIDIA_VISIBLE_DEVICES=" + GPU_UUID
                    if value.startswith("CUDA_VISIBLE_DEVICES="): args[index] = "CUDA_VISIBLE_DEVICES=0"
            args[-1] = source
            selected["controlCodeSha256"] = hashlib.sha256(source.encode()).hexdigest()
            save(OUT / (phase + "-actual-profile.json"), selected)
            started, cid, inspection = time.perf_counter(), None, None
            phase_error = None
            try:
                print(json.dumps({"phase":phase,"state":"starting_one_owned_container"}),flush=True)
                cid = command(args, timeout=30).strip()
                inspection = json.loads(command([*docker, "inspect", cid]))[0]
                validate_inspection(inspection, selected)
                save(OUT / (phase + "-container-readback.json"), inspection)
                remaining = deadline - (time.perf_counter()-started) - 20
                require(remaining > 0, "Stage deadline exhausted before start")
                command([*docker, "start", "--attach", cid], timeout=remaining)
                state = json.loads(command([*docker, "inspect", "--format", "{{json .State}}", cid],timeout=10))
                require(not state["Running"] and state["ExitCode"] == 0 and not state["OOMKilled"], "Actual worker exit/resource failure")
                result_path = output / ("processor-control.json" if phase == "cpu" else "gpu-smoke.json")
                result = json.loads(result_path.read_bytes())
                require(result["status"] == ("cpu_processor_controls_passed" if phase == "cpu" else "tiny_gpu_control_passed"), "Missing phase qualification")
            except Exception as error:
                phase_error = {"type":type(error).__name__,"message":str(error)}
            finally:
                if cid:
                    current = json.loads(command([*docker,"inspect",cid],timeout=10))[0]
                    require(current["Id"] == cid and current["Config"]["Labels"].get("codex.task") == TASK, "Cleanup exact identity mismatch")
                    command([*docker,"rm","--force",cid],timeout=10)
            phases.append({"phase":phase,"containerId":cid,"removed":bool(cid),"elapsedSeconds":time.perf_counter()-started,"deadlineSeconds":deadline,"failure":phase_error})
            print(json.dumps(phases[-1]),flush=True)
            if phase_error:
                failure = phase_error
                break
    finally:
        after = inventory()
        require(before == after, "Retained resource inventory changed")
        save(OUT / "actual-host-receipt.json", {"status":"blocked" if failure else "cpu_and_tiny_gpu_controls_passed",
            "failure":failure,"phases":phases,"calls":calls,"before":before,"after":after,
            "originalContainersPreserved":24,"originalVolumesPreserved":14,"modelsLoaded":0,"fits":0})
    if failure:
        raise ValueError("Actual runtime blocked: " + failure["message"])


REFERENCE_BRIDGE = r'''
import runpy, time, traceback
authority=Path('/inputs/reference/authorization.json')
initial=json.loads(authority.read_bytes())
need(initial['rootAssignmentSha256']=='2c64ac673da0ce97f9f2b3c6cff460f592a8196690fb68c7c8a3e171077e4298','Root instruction mismatch')
observation=initial['launchObservation']
need(observation['imageDigest']==cfg['runtimeBinding']['imageDigest'] and observation['validated'] is True,'Fresh observed image binding missing')
need(all(os.environ.get(k)==v for k,v in observation['environment'].items()),'Actual process environment mismatch')
for mount in observation['mounts']:
    need(bool(os.statvfs(mount['containerPath']).f_flag & os.ST_RDONLY)==mount['readOnly'],'Actual finite mount permissions mismatch')
need(all(n['result']==-1 and n['errno']==101 for n in network),'Current native egress not denied')
preflight={'schemaVersion':'ramp-current-process-control/1','pid':os.getpid(),'imageDigest':observation['imageDigest'],'modelOwner':'01a0fbd5-4561-7692-b366-ebd123380593','effectiveNetworkDenied':True,'effectiveResourceLimits':True,'exactMountsAndEnvironmentVerified':True,'gpuOwnerTransferred':initial['rootAuthorized'],'nativeProof':result,'observedMounts':observation['mounts'],'environment':observation['environment'],'rootAssignmentSha256':initial['rootAssignmentSha256']}
phase=initial['mode']; path=output/(phase+'-process-preflight.json')
raw=(json.dumps(preflight,indent=2)+'\n').encode()
with path.open('xb') as f:f.write(raw)
print(json.dumps({'readyForAuthorization':True,'pid':os.getpid(),'preflightBytes':len(raw),'preflightSha256':hashlib.sha256(raw).hexdigest()}),flush=True)
release=json.loads(sys.stdin.readline())
need(release['pid']==os.getpid(),'Authorization released to wrong PID')
need(Path('/inputs/reference/preflight.json').read_bytes()==raw,'Read-only actual preflight differs')
runner='/inputs/reference/compare_ramp_torch.py'
module=runpy.run_path(runner)
plan=module['read'](Path('/inputs/reference/plan.json'));module['validate_plan'](plan)
module['authorize'](plan,authority,release['authorizationSha256'])
# Validate the accepted runner gate before importing Torch or initializing CUDA.
import torch
need(torch.cuda.is_available() and torch.cuda.device_count()==1,'Single assigned GPU unavailable')
props=torch.cuda.get_device_properties(0)
need(str(props.uuid).removeprefix('GPU-')=='3989f368-bd26-bd52-9daf-037a9862f82f' and 'RTX 3070' in props.name,'Wrong physical GPU')
budget=5*1024**3
torch.cuda.set_per_process_memory_fraction(budget/props.total_memory,0)
torch.cuda.reset_peak_memory_stats()
sys.argv=[runner,'--plan','/inputs/reference/plan.json','--reference-run','--authorization',str(authority),'--authorization-sha256',release['authorizationSha256']]
started=time.perf_counter(); failure=None
try:
    module['main']()
except BaseException as error:
    failure={'type':type(error).__name__,'message':str(error)}
    traceback.print_exc()
finally:
    peak=torch.cuda.max_memory_allocated(); reserved=torch.cuda.max_memory_reserved()
    torch.cuda.empty_cache()
    resource_receipt={'pid':os.getpid(),'gpuUuid':str(props.uuid),'gpuName':props.name,'compiledCuda':torch.version.cuda,'torchAllocationBudgetBytes':budget,'peakAllocatedBytes':peak,'peakReservedBytes':reserved,'finalAllocatedBytes':torch.cuda.memory_allocated(),'elapsedSeconds':time.perf_counter()-started,'cgroupMemoryPeakBytes':int((Path('/sys/fs/cgroup')/'memory.peak').read_text()),'pidsPeak':int((Path('/sys/fs/cgroup')/'pids.peak').read_text()),'failure':failure,'trainingAuthorized':False}
    with (output/(phase+'-resources.json')).open('x',encoding='utf-8') as f:json.dump(resource_receipt,f,indent=2);f.write('\n')
need(peak<=budget and reserved<=budget,'Torch memory allocation cap exceeded')
need(failure is None,'Accepted runner failed: '+str(failure))
'''.lstrip()


PROBE_FORWARD = r'''
# Same native process, new root scope; no old baseline/fit authority is accepted.
import ast, copy, runpy, time, traceback
authority=Path('/inputs/probe/authorization.json')
gate=json.loads(authority.read_bytes())
need(gate['scope']==cfg['scope'] and gate['rootAuthorized'] is True and gate['trainingAuthorized'] is False,'Wrong diagnostic scope')
need(digest(Path('/inputs/probe/root-assignment.txt'))==cfg['rootSha256'],'Diagnostic root instruction drift')
need(digest(Path(__file__))==gate['entrySha256'],'Diagnostic entry drift')
need(digest(config)==gate['planSha256'],'Diagnostic plan drift')
observation=gate['launchObservation']
need(observation['validated'] and observation['imageDigest']==cfg['runtimeBinding']['imageDigest'],'Fresh image readback required')
need(all(os.environ.get(k)==v for k,v in observation['environment'].items()),'Actual diagnostic environment mismatch')
for mount in observation['mounts']:
    need(bool(os.statvfs(mount['containerPath']).f_flag & os.ST_RDONLY)==mount['readOnly'],'Diagnostic mount permission mismatch')
proof={'schemaVersion':'ramp-empty-loss-process/1','pid':os.getpid(),'scope':cfg['scope'],
    'rootSha256':cfg['rootSha256'],'imageDigest':observation['imageDigest'],'bounds':cfg['bounds'],
    'gpuUuid':observation['environment']['NVIDIA_VISIBLE_DEVICES'],'gpuOwnerTransferred':True,
    'modelOwner':'01a0fbd5-4561-7692-b366-ebd123380593','effectiveNetworkDenied':True,
    'effectiveResourceLimits':True,'exactMountsAndEnvironmentVerified':True,'nativeProof':result,
    'observedMounts':observation['mounts'],'environment':observation['environment']}
raw=(json.dumps(proof,indent=2)+'\n').encode()
need(len(raw)<=262144,'Process receipt bound exceeded')
with (output/'process-preflight.json').open('xb') as f:f.write(raw)
print(json.dumps({'readyForAuthorization':True,'pid':os.getpid(),'preflightBytes':len(raw),
    'preflightSha256':hashlib.sha256(raw).hexdigest()}),flush=True)
release=json.loads(sys.stdin.readline())
need(release['pid']==os.getpid() and Path('/inputs/probe/preflight.json').read_bytes()==raw,'Same-PID preflight required')
need(digest(authority)==release['authorizationSha256'],'Diagnostic authorization drift')
gate=json.loads(authority.read_bytes())
need(gate['scope']==cfg['scope'] and gate['preflightReceipt']['sha256']==hashlib.sha256(raw).hexdigest()
    and gate['entrySha256']==digest(Path(__file__)) and gate['planSha256']==digest(config)
    and gate['rootAuthorized'] is True and gate['trainingAuthorized'] is False,'Exact diagnostic authority required')
need(proof['gpuUuid']=='GPU-3989f368-bd26-bd52-9daf-037a9862f82f','Wrong GPU transfer')
proposal=json.loads(Path('/inputs/probe/proposal.json').read_bytes())
package=Path(importlib.metadata.distribution('transformers').locate_file('transformers'))
for expected in proposal['sourceReview']['pins']:
    name=Path(expected['path'].replace('\\','/')).name.removeprefix('primary-')
    relative=('loss/'+name) if name.startswith('loss_') else ('models/rf_detr/'+name if name in ['modeling_rf_detr.py','image_processing_rf_detr.py'] else name)
    installed=package/relative
    need(installed.stat().st_size==expected['bytes'] and digest(installed)==expected['sha256'],'Installed loss/model/processor/Trainer source drift')
need(cfg['scope']['selectedImageIds']==[i['imageId'] for i in proposal['nextExperiment']['inputs']]
    and cfg['scope']['forwardWithBuiltInLossMax']==2 and cfg['scope']['backward']==cfg['scope']['optimizer']==0,'Frozen two-call contract changed')
started=time.perf_counter();failure=None;torch=None;diagnostics=None;calls=[]
def bounded_json(name,value):
    encoded=(json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
    need(len(encoded)<=262144,'Diagnostic receipt bound exceeded')
    with (output/name).open('xb') as f:f.write(encoded)
def offline(event,args):
    if event in {'socket.connect','socket.getaddrinfo','socket.bind','socket.sendto','subprocess.Popen','os.system'}:
        raise RuntimeError('Diagnostic network/child launch refused')
sys.addaudithook(offline)
try:
    import torch
    import numpy as np
    from PIL import Image
    from pycocotools import mask as coco_mask
    from transformers import RfDetrForInstanceSegmentation,RfDetrImageProcessor,set_seed
    torch.set_num_threads(2);torch.set_num_interop_threads(1)
    need(torch.cuda.is_available() and torch.cuda.device_count()==1,'Single GPU required')
    props=torch.cuda.get_device_properties(0)
    need(str(props.uuid).removeprefix('GPU-')==proof['gpuUuid'].removeprefix('GPU-') and 'RTX 3070' in props.name,'Wrong physical GPU')
    budget=cfg['bounds']['gpuAllocationBytes']
    torch.cuda.set_per_process_memory_fraction(budget/props.total_memory,0);torch.cuda.reset_peak_memory_stats()
    torch.backends.cuda.matmul.allow_tf32=False;torch.backends.cudnn.allow_tf32=False
    set_seed(42)
    model,loading=RfDetrForInstanceSegmentation.from_pretrained('/inputs/model',local_files_only=True,
        use_safetensors=True,attn_implementation='eager',output_loading_info=True)
    need(not any(loading.get(k) for k in ['missing_keys','unexpected_keys','mismatched_keys','error_msgs']),'Original strict load failed')
    need(model.config.id2label=={0:'building'} and model.config.num_labels==1 and model.config.num_queries==200
        and model.config.group_detr==13 and model.config.disable_custom_kernels is True,'Original head/query/group contract drift')
    need(all(p.dtype==torch.float32 and torch.isfinite(p).all().item() for p in model.parameters()),'Original finite FP32 parameters required')
    processor=RfDetrImageProcessor.from_pretrained('/inputs/model',local_files_only=True)
    # Compile only the accepted source adapter/observer nodes. Never execute the
    # runner main, execute_trainer, Trainer construction, optimizer or fit route.
    tree=ast.parse(Path('/inputs/plan/train_building_ramp.py').read_text())
    trainer_node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='execute_trainer')
    nodes=[next(n for n in tree.body if getattr(n,'name',None)==key) for key in ['diagnostic_tensor','LossDiagnostics']]
    nodes += [next(n for n in trainer_node.body if getattr(n,'name',None)==key) for key in ['CocoPool','collate']]
    namespace={'Path':Path,'json':json,'torch':torch,'np':np,'Image':Image,'coco_mask':coco_mask,
        'processor':processor,'read_json':lambda p:json.loads(Path(p).read_bytes()),'require':need,'pilot':False}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'/inputs/plan/train_building_ramp.py','exec'),namespace)
    diagnostics=namespace['LossDiagnostics'](torch,output)
    namespace['diagnostics']=diagnostics
    pool=namespace['CocoPool']({'annotationPin':{'path':'/inputs/coco/train/_annotations.coco.json'}})
    selected=proposal['nextExperiment']['inputs'];selected_ids=[i['imageId'] for i in selected]
    images=[im for im in pool.images if im['id'] in selected_ids]
    for item in selected:
        image=next(im for im in images if im['id']==item['imageId'])
        anns=pool.annotations[image['id']]
        need(image['file_name']==item['fileName'] and [image['width'],image['height']]==[256,256]
            and [a['id'] for a in anns]==item['sourceAnnotationIds']
            and len(anns)==item['sourceInstanceCount'] and all(a['category_id']==1 for a in anns),'Selected source identity drift')
    diagnostics.register_sources(images,{im['id']:pool.annotations[im['id']] for im in images})
    model.to('cuda');model.train();diagnostics.capture_state(model)
    model.register_forward_pre_hook(diagnostics.before_forward,with_kwargs=True)
    def guard(module,inputs,outputs):
        need(time.perf_counter()-started<=135,'Diagnostic inner deadline exceeded')
        need(torch.cuda.memory_allocated()<=budget and torch.cuda.memory_reserved()<=budget,'Diagnostic GPU cap exceeded')
        loss=outputs.loss
        valid=(loss is not None and loss.numel()==1 and torch.isfinite(loss).all().item()
            and all(torch.isfinite(v).all().item() for v in outputs.loss_dict.values()))
        try:diagnostics.after_forward(outputs,valid)
        except Exception as error:
            print('Loss telemetry unavailable: '+type(error).__name__+': '+str(error)[:500],file=sys.stderr)
        need(valid,'Nonfinite built-in loss; stop before backward and retain the attempt')
        need(list(outputs.pred_masks.shape[-2:])==[108,108],'Native mask grid changed')
        calls.append(copy.deepcopy(diagnostics.current))
    model.register_forward_hook(guard)
    for item in selected:
        need(diagnostics.forward_calls<2 and time.perf_counter()-started<=135,'Two-call/deadline bound exceeded')
        index=next(i for i,im in enumerate(pool.images) if im['id']==item['imageId'])
        batch=namespace['collate']([pool[index]])
        batch={k:([{n:v.to('cuda') for n,v in t.items()} for t in value] if k=='labels' else value.to('cuda')) for k,value in batch.items()}
        with torch.no_grad(),torch.autocast(device_type='cuda',enabled=False):model(**batch)
    need(diagnostics.forward_calls==2,'Incomplete two-call diagnostic')
except BaseException as error:
    failure={'type':type(error).__name__,'message':str(error)[:4000]};traceback.print_exc()
finally:
    bounded_json('result.json',{'schemaVersion':'ramp-empty-loss-result/1','scope':cfg['scope'],
        'state':'stopped_before_backward' if failure else 'both_controls_finite',
        'forwardCalls':diagnostics.forward_calls if diagnostics else 0,'completedCalls':calls,'failure':failure,
        'optimizerUpdates':0,'backwardCalls':0,'checkpointSaved':False,'trainingAuthorized':False,
        'historicalFailingInput':'UNKNOWN','authorizationSha256':release['authorizationSha256']})
    metrics={'pid':os.getpid(),'failure':failure,'elapsedSeconds':time.perf_counter()-started,
        'cgroupMemoryPeakBytes':int((Path('/sys/fs/cgroup')/'memory.peak').read_text()),
        'pidsPeak':int((Path('/sys/fs/cgroup')/'pids.peak').read_text()),'trainingAuthorized':False}
    if torch is not None and torch.cuda.is_initialized():
        metrics.update(gpuUuid=str(torch.cuda.get_device_properties(0).uuid),
            peakAllocatedBytes=torch.cuda.max_memory_allocated(),peakReservedBytes=torch.cuda.max_memory_reserved(),
            preExitAllocatedBytes=torch.cuda.memory_allocated())
    bounded_json('resources.json',metrics)
    if metrics.get('peakAllocatedBytes',0)>5368709120 or metrics.get('peakReservedBytes',0)>5368709120:
        failure=failure or {'type':'ResourceCap','message':'Torch cap exceeded'}
need(failure is None,'Diagnostic stopped: '+str(failure))
'''.lstrip()


def prepare_empty_probe(root_instruction):
    require(root_instruction == PROBE / "root-assignment.txt" and pin(root_instruction)["sha256"] == PROBE_ROOT_SHA,
            "Exact separate two-forward root instruction required")
    require(pin(DIAGNOSIS/"train_building_ramp.py")["sha256"] == PROBE_RUNNER_SHA
            and pin(DIAGNOSIS/"diagnosis-proposal.json")["sha256"] == PROBE_PROPOSAL_SHA, "Accepted diagnostic source drift")
    proposal=json.loads((DIAGNOSIS/"diagnosis-proposal.json").read_bytes())
    binding=checked_json(BINDING)
    old_interface=checked_json(INTERFACE)  # Metadata only; no old directory scan.
    mounts=[];inventory=[]
    def add(path,target,expected=None):
        actual=pin(path)
        if expected: require((actual["bytes"],actual["sha256"])==(expected["bytes"],expected["sha256"]),"Probe input pin drift")
        mounts.append({"hostPath":actual["path"],"containerPath":target,"readOnly":True,"kind":"file"})
        inventory.append({"hostPin":actual,"containerPin":{**actual,"path":target}})
    model_host=next(m["hostPath"] for m in old_interface["mounts"] if m["role"]=="model")
    for expected in proposal["nextExperiment"]["modelConfigProcessorPins"].values():
        add(Path(model_host)/PurePosixPath(expected["path"]).name,expected["path"],expected)
    add(DATA/"d06-ramp-coco-20261005/train/_annotations.coco.json",proposal["nextExperiment"]["coco"]["path"],proposal["nextExperiment"]["coco"])
    for item in proposal["nextExperiment"]["inputs"]:
        add(item["hostPath"],item["retainedImagePinNotReread"]["path"],item["retainedImagePinNotReread"])
    add(DIAGNOSIS/"train_building_ramp.py","/inputs/plan/train_building_ramp.py")
    add(DIAGNOSIS/"diagnosis-proposal.json","/inputs/probe/proposal.json")
    add(root_instruction,"/inputs/probe/root-assignment.txt")
    add(BINDING[0],"/inputs/plan/runtime-binding.json")
    for key in ["packageLock","installedMetadata","imageMetadata"]:
        expected=binding[key];add(expected["path"],"/inputs/plan/"+Path(expected["path"]).name,expected)
    plan={"schemaVersion":"ramp-empty-loss-plan/1","scope":PROBE_SCOPE,"rootSha256":PROBE_ROOT_SHA,
        "launcherPin":pin(__file__),"runtimeBinding":binding,"mounts":mounts,"inventory":inventory,
        "bounds":proposal["nextExperiment"]["bounds"],"trainingAuthorized":False}
    with (PROBE/"execution-code.py").open("xb") as out:out.write(Path(__file__).read_bytes())
    plan_path=PROBE/"plan.json";save(plan_path,plan)
    native=CONTROL.replace("need(not list(Path('/dev').glob('nvidia*')) and not Path('/dev/dxg').exists(),'Unexpected GPU devices in CPU profile')","# Exact physical GPU follows same-PID diagnostic authority.")
    native=native.replace("/inputs/plan/mounted-config.json","/inputs/probe/plan.json")
    native=native.replace("config.stat().st_size==52751","config.stat().st_size=="+str(plan_path.stat().st_size))
    native=native.replace(CONFIG[2],pin(plan_path)["sha256"]).replace("'gpuAssigned':False","'gpuAssigned':True")
    native=native.replace("actual_cpu_native_control_passed","actual_empty_loss_native_control_passed")
    entry=native+PROBE_FORWARD;compile(entry,"<empty-loss-probe>","exec")
    with (PROBE/"entry.py").open("x",encoding="utf-8",newline="\n") as out:out.write(entry)
    return {"plan":pin(plan_path),"entry":pin(PROBE/"entry.py"),"launcher":pin(PROBE/"execution-code.py"),
            "inputPins":len(inventory),"scope":PROBE_SCOPE,"preparedOnly":True}


def probe_host_job():
    """Read the current Windows Job ceiling; flags cannot assert containment."""
    import ctypes
    from ctypes import wintypes
    class Basic(ctypes.Structure):
        _fields_=[("processTime",ctypes.c_int64),("jobTime",ctypes.c_int64),("flags",wintypes.DWORD),
            ("minWS",ctypes.c_size_t),("maxWS",ctypes.c_size_t),("active",wintypes.DWORD),
            ("affinity",ctypes.c_size_t),("priority",wintypes.DWORD),("scheduling",wintypes.DWORD)]
    class Io(ctypes.Structure):
        _fields_=[(k,ctypes.c_uint64) for k in ["readOps","writeOps","otherOps","readBytes","writeBytes","otherBytes"]]
    class Limits(ctypes.Structure):
        _fields_=[("basic",Basic),("io",Io),("processMemory",ctypes.c_size_t),("jobMemory",ctypes.c_size_t),
            ("peakProcess",ctypes.c_size_t),("peakJob",ctypes.c_size_t)]
    kernel=ctypes.WinDLL("kernel32",use_last_error=True)
    kernel.GetCurrentProcess.restype=ctypes.c_void_p
    kernel.IsProcessInJob.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.POINTER(wintypes.BOOL)]
    kernel.QueryInformationJobObject.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p]
    inside=wintypes.BOOL();limits=Limits()
    require(kernel.IsProcessInJob(kernel.GetCurrentProcess(),None,ctypes.byref(inside)) and inside.value,
            "Diagnostic requires actual current host Job")
    require(kernel.QueryInformationJobObject(None,9,ctypes.byref(limits),ctypes.sizeof(limits),None)
            and limits.basic.flags & 0x0200 and limits.basic.flags & 0x2000
            and limits.jobMemory==536870912,"Actual 512MiB kill-on-close host Job required")
    return {"jobMemoryCapBytes":limits.jobMemory,"killOnClose":True,"peakJobPrivateBytes":limits.peakJob}


def empty_probe_checks(root_instruction, execution_state):
    started=time.perf_counter()
    require(root_instruction == PROBE/"root-assignment.txt" and pin(root_instruction)["sha256"]==PROBE_ROOT_SHA,
            "Exact separate two-forward root instruction required")
    host_job=probe_host_job()
    prepared=json.loads((PROBE/"prepared.json").read_bytes())
    for key in ["plan","entry","launcher"]:
        require(pin(prepared[key]["path"])==prepared[key],"Prepared diagnostic code/plan drift")
    require(pin(__file__)["sha256"]==prepared["launcher"]["sha256"],"Exact diagnostic launcher required")
    plan=json.loads((PROBE/"plan.json").read_bytes())
    require(plan["scope"]==PROBE_SCOPE and plan["rootSha256"]==PROBE_ROOT_SHA,"Distinct probe scope drift")
    for row in plan["inventory"]:require(pin(row["hostPin"]["path"])==row["hostPin"],"Frozen diagnostic input drift")
    require(not (PROBE/"output").exists(),"Probe output must be new")
    save(PROBE/"attempt.json",{"probeAttempts":1,"maxForwardCalls":2,"rootInstruction":pin(root_instruction)})
    binding=plan["runtimeBinding"];output=PROBE/"output";output.mkdir()
    auth_path=PROBE/"authorization.json";control_path=PROBE/"preflight.json"
    save(control_path,{"state":"awaiting_actual_same_pid"})
    auth={"schemaVersion":"ramp-empty-loss-authorization/1","rootAuthorized":True,"trainingAuthorized":False,
        "scope":PROBE_SCOPE,"rootSha256":PROBE_ROOT_SHA,"entrySha256":prepared["entry"]["sha256"],"planSha256":prepared["plan"]["sha256"],"hostJob":host_job}
    save(auth_path,auth)
    overrides={"NVIDIA_VISIBLE_DEVICES":GPU_UUID,"CUDA_VISIBLE_DEVICES":"0","HOME":"/tmp",
        "HF_HOME":"/outputs/rfdetr/cache/huggingface","XDG_CACHE_HOME":"/outputs/rfdetr/cache","TMPDIR":"/tmp"}
    environment=dict(i.split("=",1) for i in binding["imageEnvironment"]);environment.update(overrides)
    mounts=plan["mounts"]+[{"hostPath":str(PROBE/name),"containerPath":"/inputs/probe/"+name,"readOnly":True,"kind":"file"}
        for name in ["plan.json","entry.py","authorization.json","preflight.json"]]
    writable={"hostPath":str(output),"containerPath":"/outputs/rfdetr","readOnly":False,"kind":"directory"}
    for i,mount in enumerate([*mounts,writable]):
        hp=host_path(mount["hostPath"]);cp=container_path(mount["containerPath"])
        for other in [*mounts,writable][:i]:
            oh=Path(other["hostPath"]);oc=PurePosixPath(other["containerPath"])
            require(not(hp.is_relative_to(oh) or oh.is_relative_to(hp) or cp.is_relative_to(oc) or oc.is_relative_to(cp)),"Diagnostic mount overlap refused")
    args=["docker","--context","desktop-linux","create","--pull=never","--platform=linux/amd64",
        "--name",PROBE.name+"-"+uuid.uuid4().hex[:12],"--label","codex.task="+PROBE.name,
        "--network=none","--read-only","--cap-drop=ALL","--security-opt=no-new-privileges","--user=10001:10001",
        "--init","--ipc=private","--pids-limit=32","--cpus=2","--cpuset-cpus=0,1","--memory=5g","--memory-swap=5g",
        "--shm-size=16m","--tmpfs=/tmp:rw,noexec,nosuid,size=16m","--workdir=/inputs/plan",
        "--entrypoint="+binding["pythonExecutable"],"--interactive","--gpus","device="+GPU_UUID]
    for k,v in overrides.items():args += ["--env",k+"="+v]
    for m in [*mounts,writable]:args += ["--mount","type=bind,source="+m["hostPath"]+",target="+m["containerPath"]+(",readonly" if m["readOnly"] else "")]
    argv=["-I","-B","/inputs/probe/entry.py"];args += [binding["imageDigest"],*argv]
    selected={"task":PROBE.name,"imageDigest":binding["imageDigest"],"python":binding["pythonExecutable"],
        "gpuAssigned":True,"createArgv":args,"processArgv":argv,"environment":environment,"mounts":mounts,
        "output":writable,"policy":{"tmpfs":{"/tmp":"rw,noexec,nosuid,size=16m"}}}
    save(PROBE/"profile.json",selected)
    docker=["docker","--context","desktop-linux"];calls=[];cid=None;process=None;reader=None;failure=None;ready={}
    def remaining(cleanup=False):
        value=180-(time.perf_counter()-started)-(0 if cleanup else 45)
        require(value>0,"180s diagnostic/cleanup deadline exhausted");return value
    def command(argv,cleanup=False):
        p=subprocess.run(argv,capture_output=True,text=True,timeout=min(10,remaining(cleanup)))
        calls.append({"argv":argv,"exitCode":p.returncode,"stdout":p.stdout[:65536],"stderr":p.stderr[:4000]})
        require(p.returncode==0,"Diagnostic Docker command failed: "+p.stderr[:2000]);return p.stdout
    def inventory(cleanup=False):
        return {"containers":sorted(command([*docker,"ps","-aq","--no-trunc"],cleanup).splitlines()),
            "volumes":sorted(command([*docker,"volume","ls","-q"],cleanup).splitlines())}
    before=inventory();require(len(before["containers"])==24 and len(before["volumes"])==14,"Retained runtime inventory changed")
    try:
        actual=json.loads(command([*docker,"image","inspect",binding["imageDigest"]]))[0]
        retained=json.loads(Path(binding["imageMetadata"]["path"]).read_bytes())
        require(all(actual[k]==retained[k] for k in ["Id","Config","RootFS","Descriptor"]),"Sealed diagnostic image drift")
        cid=command(args).strip();inspection=json.loads(command([*docker,"inspect",cid]))[0]
        validate_inspection(inspection,selected);save(PROBE/"container-readback.json",inspection)
        auth["launchObservation"]={"imageDigest":inspection["Image"],"validated":True,"mounts":[*mounts,writable],"environment":environment}
        auth_path.write_text(json.dumps(auth,indent=2)+"\n",encoding="utf-8",newline="\n")
        channel=queue.Queue();execution_state["attempted"]=True
        process=subprocess.Popen([*docker,"start","--attach","--interactive",cid],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        def drain():
            with (PROBE/"container.log").open("xb") as sink:
                size=0
                for line in iter(process.stdout.readline,b""):
                    size+=len(line)
                    if size>262144:channel.put(ValueError("Probe log bound exceeded"));break
                    sink.write(line);sink.flush();channel.put(line)
            channel.put(None)
        reader=threading.Thread(target=drain,daemon=True);reader.start()
        while True:
            line=channel.get(timeout=remaining());require(line is not None,"Probe stopped before native proof")
            if isinstance(line,Exception):raise line
            try:ready=json.loads(line)
            except(ValueError,UnicodeDecodeError):continue
            if ready.get("readyForAuthorization"):break
        raw=(output/"process-preflight.json").read_bytes()
        require(len(raw)==ready["preflightBytes"] and hashlib.sha256(raw).hexdigest()==ready["preflightSha256"],"Diagnostic preflight transport drift")
        require(json.loads(raw)["pid"]==ready["pid"],"Diagnostic proof PID drift")
        execution_state["confirmed"]=True;control_path.write_bytes(raw)
        auth["preflightReceipt"]={"path":"/inputs/probe/preflight.json","bytes":len(raw),"sha256":ready["preflightSha256"]}
        auth_path.write_text(json.dumps(auth,indent=2)+"\n",encoding="utf-8",newline="\n")
        process.stdin.write((json.dumps({"pid":ready["pid"],"authorizationSha256":pin(auth_path)["sha256"]})+"\n").encode())
        process.stdin.flush();process.stdin.close();exit_code=process.wait(timeout=remaining())
        reader.join(timeout=3);require(not reader.is_alive(),"Diagnostic reader survived")
        state=json.loads(command([*docker,"inspect","--format","{{json .State}}",cid]))
        save(PROBE/"container-exit.json",state)
        require(exit_code==0 and state["ExitCode"]==0 and not state["OOMKilled"],"Probe stopped; retained diagnostic output/log")
    except Exception as error:failure={"type":type(error).__name__,"message":str(error)}
    finally:
        if process and process.stdin and not process.stdin.closed:process.stdin.close()
        if process and process.poll() is None:process.kill();process.wait(timeout=3)
        if cid:
            current=json.loads(command([*docker,"inspect",cid],True))[0]
            require(current["Id"]==cid and current["Config"]["Labels"].get("codex.task")==PROBE.name,"Exact probe cleanup identity mismatch")
            command([*docker,"rm","--force",cid],True)
        if reader:reader.join(timeout=3);require(not reader.is_alive(),"Probe reader survived cleanup")
        if process and process.stdout:process.stdout.close()
        after=inventory(True);require(before==after,"Probe altered retained containers/volumes")
        save(PROBE/"host-receipt.json",{"scope":PROBE_SCOPE,"containerId":cid,"pid":ready.get("pid"),"removed":bool(cid),
            "failure":failure,"calls":calls,"before":before,"after":after,"elapsedSeconds":time.perf_counter()-started,"trainingAuthorized":False})
    if failure:raise ValueError(failure["message"])


def repaired_evidence_matches(interface, plan):
    # This interface lists host pins; the plan maps them to container paths.
    mounts = {m["role"]: m for m in plan["mounts"]}
    return interface["evidenceInventory"] == [
        {**item, "path": mounts[role]["hostPath"]} for role, item in plan["evidence"].items()]


def repaired_metadata():
    """Read only the three frozen preparation files; no source/model campaign."""
    plan = checked_json((REPAIRED_PREP / "plan.json", 82606, REPAIRED_PLAN_SHA))
    interface = checked_json((REPAIRED_PREP / "interface.json", 42094, REPAIRED_INTERFACE_SHA))
    require(pin(REPAIRED_PREP / "train_building_ramp.py")["sha256"] == REPAIRED_RUNNER_SHA,
            "Repaired runner drift")
    canonical = copy.deepcopy(plan); canonical.pop("planSha256")
    require(hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest() == plan["planSha256"] == REPAIRED_CANONICAL_SHA,
            "Repaired canonical plan drift")
    require(plan["trainingAuthorized"] is False and interface["trainingAuthorized"] is False
            and interface["task"] == "D07-RFDETR-REPAIRED-PILOT-FIT"
            and interface["authorizationContract"]["scope"] == REPAIRED_SCOPE
            and interface["lossImplementation"] == plan["lossImplementation"]
            and len(interface["allReadOnlyMounts"]) == 23
            and interface["allReadOnlyMounts"][:-1] == plan["mounts"]
            and interface["inputInventory"] == plan["inventory"]
            and repaired_evidence_matches(interface, plan), "Repaired preparation interface drift")
    require(not ({"development", "developmentOriginal"} & {m["role"] for m in plan["mounts"]})
            and all("/valid/" not in r["containerPin"]["path"] for r in plan["inventory"]),
            "Development inputs refused during fit")
    return interface, plan


def repaired_release(path, expected_sha, interface, plan):
    """A later root callback supplies this JSON's hash; prep templates are inert."""
    require(path == REPAIRED_RUN / "root-release.json" and isinstance(expected_sha, str)
            and pin(path)["sha256"] == expected_sha, "Exact new root release/hash required")
    release = json.loads(path.read_bytes())
    require(release["schemaVersion"] == "rfdetr-repaired-fit-release/1"
            and release["task"] == REPAIRED_TASK and release["scope"] == REPAIRED_SCOPE
            and release["rootThreadId"] == "01a0ed8a-4383-79c3-a0ae-35c1e969ef66"
            and release["modelOwnerThreadId"] == "01a0fbd5-4561-7692-b366-ebd123380593"
            and release["fitAuthorized"] is True and release["evaluationAuthorized"] is False
            and release["gpuOwnerTransferred"] is True and release["gpuUuid"] == GPU_UUID
            and release["planSha256"] == plan["planSha256"]
            and release["scriptSha256"] == REPAIRED_RUNNER_SHA
            and release["interfaceSha256"] == REPAIRED_INTERFACE_SHA
            and release["lossImplementation"] == plan["lossImplementation"]
            and release["bounds"] == plan["bounds"] and release["lossDiagnostics"] is False,
            "Preparation, CPU confirmation or historical authority grants no repaired fit")
    window = release["exclusiveWindow"]
    require(all(isinstance(window[k], str) for k in ("notBeforeUtc", "expiresUtc")),
            "Exclusive window remains unbound")
    now = datetime.datetime.now(datetime.timezone.utc)
    start, end = (datetime.datetime.fromisoformat(window[k]) for k in ("notBeforeUtc", "expiresUtc"))
    require(start.utcoffset() == end.utcoffset() == datetime.timedelta(0)
            and start <= now and (end - now).total_seconds() >= 900
            and window["task"] == REPAIRED_TASK and window["d08LiveApiWindowExcluded"] is True,
            "Fresh exclusive GPU/runtime window with 900s remaining required")
    guard = Path("C:/Users/kvina/.codex/worktrees/ml-teacher-20261002/3d-ulpin/scripts/usp/document-models/run_trial.py")
    for key, target in [("launcherSource", REPAIRED_RUN / "execution-code.py"),
                        ("nativeEntry", REPAIRED_RUN / "native-entry.py"),
                        ("supervisor", REPAIRED_RUN / "supervise.py"), ("hostJobGuard", guard)]:
        actual = pin(target); expected = release[key]
        require(Path(expected["path"]) == target and actual == expected, "Frozen repaired launcher/entry/supervisor/Job drift")
    require(Path(__file__).resolve() == REPAIRED_RUN / "execution-code.py"
            and os.environ.get("RFDETR_GATED_PARENT") == str(os.getpid()),
            "Frozen launcher must run under the pinned gated host Job")
    require((REPAIRED_RUN / "native-entry.py").read_bytes() == repaired_native_source().encode(),
            "Frozen native entry differs from launcher")
    require(Path(interface["writableOutput"]["hostPath"]) == REPAIRED_PREP / "output",
            "Exact repaired task output required")
    return release


def repaired_native_source():
    source = CONTROL.replace("need(not list(Path('/dev').glob('nvidia*')) and not Path('/dev/dxg').exists(),'Unexpected GPU devices in CPU profile')",
                             "# Exact physical GPU checked after current-process authorization.")
    source = source.replace("native-control.json", "repaired-pilot-fit-native.json").replace("'gpuAssigned':False", "'gpuAssigned':True")
    source = source.replace("actual_cpu_native_control_passed", "actual_pilot_native_control_passed") + pilot_bridge(repaired=True)
    return source.replace("/inputs/plan/mounted-config.json", "/inputs/pilot/plan.json").replace(
        "config.stat().st_size==52751", "config.stat().st_size==82606").replace(CONFIG[2], REPAIRED_PLAN_SHA)


def pilot_bridge(repaired=False):
    """Reuse the same-PID pause/seal/resume primitive for the separate fit gate."""
    bridge = REFERENCE_BRIDGE.replace(REF_ROOT_SHA, FIT_ROOT_SHA)
    if repaired:
        bridge = bridge.replace("need(initial['rootAssignmentSha256']=='" + FIT_ROOT_SHA + "','Root instruction mismatch')",
            "need(initial['rootAssignmentSha256']==hashlib.sha256(initial['rootAssignment'].encode('utf-8')).hexdigest(),'Root release text mismatch')\n"
            "root=json.loads(initial['rootAssignment'])\n"
            "need(root['schemaVersion']=='rfdetr-repaired-fit-release/1' and root['task']=='" + REPAIRED_TASK + "' "
            "and root['fitAuthorized'] is True and root['evaluationAuthorized'] is False "
            "and root['scope']=='" + REPAIRED_SCOPE + "' and root['planSha256']==cfg['planSha256'] "
            "and root['scriptSha256']==cfg['scriptPin']['sha256'] and root['lossImplementation']==cfg['lossImplementation'] "
            "and root['gpuUuid']=='" + GPU_UUID + "' and root['gpuOwnerTransferred'] is True "
            "and root['launcherSource']['sha256']==initial['launcherSourceSha256'] "
            "and root['nativeEntry']['sha256']==initial['nativeEntrySha256'],'Exact repaired root release required')")
    bridge = bridge.replace("/inputs/reference/authorization.json", "/inputs/pilot/authorization.json")
    bridge = bridge.replace("/inputs/reference/preflight.json", "/inputs/pilot/current-process-preflight.json")
    bridge = bridge.replace("/inputs/reference/compare_ramp_torch.py", "/inputs/plan/train_building_ramp.py")
    bridge = bridge.replace("plan=module['read'](Path('/inputs/reference/plan.json'));module['validate_plan'](plan)\nmodule['authorize'](plan,authority,release['authorizationSha256'])",
        "plan=module['read_json'](Path('/inputs/pilot/plan.json'));module['validate_pilot'](plan)\n"
        "module['check_gate'](authority,release['authorizationSha256'],plan)")
    bridge = bridge.replace("phase=initial['mode']; path=output/(phase+'-process-preflight.json')",
        "preflight.update(gpuUuid=observation['environment']['NVIDIA_VISIBLE_DEVICES'],"
        "bounds=cfg['bounds'],planSha256=cfg['planSha256'])\n"
        "phase=initial['mode']; path=output/(phase+'-process-preflight.json')")
    bridge = bridge.replace("'--plan','/inputs/reference/plan.json','--reference-run'",
                            "'--config','/inputs/pilot/plan.json','--execute'")
    # This resource receipt follows the actual fit gate. The earlier native
    # proof still accurately records no Torch/model load and no fit authority.
    bridge = bridge.replace("'trainingAuthorized':False", "'trainingAuthorized':True")
    require("module['check_gate'](authority,release['authorizationSha256'],plan)" in bridge
            and "/inputs/reference/" not in bridge, "Pilot bridge binding incomplete")
    return bridge


def pilot_inputs(interface, plan, repaired=False):
    """Verify only the frozen interface's explicit pins and finite mappings."""
    require(len(interface["allReadOnlyMounts"]) == (23 if repaired else 24)
            and interface["allReadOnlyMounts"][:-1] == plan["mounts"]
            and interface["inputInventory"] == plan["inventory"]
            and (repaired_evidence_matches(interface, plan) if repaired else
                 interface["evidenceInventory"] == plan["evidence"]), "Frozen pilot interface drift")
    require(interface["runtimeRequirements"]["bounds"] == plan["bounds"]
            and interface["runtimeRequirements"]["gpuUuid"] == GPU_UUID
            and interface["canonicalPlanSha256"] == plan["planSha256"], "Pilot bounds/plan drift")
    check_plan = copy.deepcopy(plan); expected_sha = check_plan.pop("planSha256")
    require(hashlib.sha256(json.dumps(check_plan, sort_keys=True, separators=(",", ":"),
            allow_nan=False).encode()).hexdigest() == expected_sha, "Canonical pilot plan drift")
    def mapped(container_pin):
        path = container_path(container_pin["path"])
        matches = []
        for mount in interface["allReadOnlyMounts"]:
            host = host_path(mount["hostPath"], mount["kind"])
            target = container_path(mount["containerPath"])
            require(mount["readOnly"] is True, "Writable pilot input refused")
            if path == target or mount["kind"] == "directory" and path.is_relative_to(target):
                matches.append(host / str(path.relative_to(target)))
        require(len(matches) == 1, "Pilot input mapping missing/overlapping")
        actual = pin(matches[0])
        require((actual["bytes"], actual["sha256"]) == (container_pin["bytes"], container_pin["sha256"]),
                "Pilot input pin mismatch")
        return actual
    for row in interface["inputInventory"]:
        actual = mapped(row["containerPin"])
        require(Path(actual["path"]) == Path(row["hostPin"]["path"])
                and actual["bytes"] == row["hostPin"]["bytes"]
                and actual["sha256"] == row["hostPin"]["sha256"], "Pilot host/container pin mismatch")
    for evidence in (plan["evidence"].values() if repaired else interface["evidenceInventory"].values()):
        mapped(evidence)
    mapped({**interface["plan"], "path": interface["allReadOnlyMounts"][-1]["containerPath"]}
           if repaired else interface["allReadOnlyMounts"][-1]["pin"])


def reference_checks(root_instruction, execution_state, baseline=False, pilot=False, repaired=False, release_sha=None):
    started = time.perf_counter()  # Pilot's 900s includes pin checks and cleanup.
    require(not repaired or pilot, "Repaired authority is fit-only")
    require(not (baseline and pilot), "Reference and fit authorities are distinct")
    prepared = REPAIRED_PREP if repaired else (FIT_PREP if pilot else (BL_PREP if baseline else REF))
    run_root = REPAIRED_RUN if repaired else (FIT_RUN if pilot else (BL_RUN if baseline else REF_RUN))
    root_sha = release_sha if repaired else (FIT_ROOT_SHA if pilot else (BL_ROOT_SHA if baseline else REF_ROOT_SHA))
    runner_sha = REPAIRED_RUNNER_SHA if repaired else (FIT_RUNNER_SHA if pilot else (BL_RUNNER_SHA if baseline else REF_RUNNER_SHA))
    interface_sha = REPAIRED_INTERFACE_SHA if repaired else (FIT_INTERFACE_SHA if pilot else (BL_INTERFACE_SHA if baseline else REF_INTERFACE_SHA))
    runner_name = "train_building_ramp.py" if pilot else "compare_ramp_torch.py"
    plan_pins = {"repaired-pilot-fit": REPAIRED_PLAN_SHA} if repaired else ({"pilot-fit": FIT_PLAN_SHA} if pilot else ({"experimental-baseline": BL_PLAN_SHA} if baseline else REF_PLANS))
    task_id = REPAIRED_TASK if repaired else ("D07-RFDETR-PILOT-FIT-ACTUAL" if pilot else ("D07-RFDETR-TORCH-BASELINE-V2-ACTUAL" if baseline else "D07-RFDETR-TORCH-REFERENCE"))
    interface_name = "interface.json" if repaired else "mount-interface.json"
    if repaired:
        interface, repaired_plan = repaired_metadata()
        root_release = repaired_release(root_instruction, release_sha, interface, repaired_plan)
    else:
        require(root_instruction == run_root / "root-assignment.txt"
                and pin(root_instruction)["sha256"] == root_sha, "Exact reference root instruction required")
    require(pin(prepared / runner_name)["sha256"] == runner_sha
            and pin(prepared / interface_name)["sha256"] == interface_sha, "Reference runner/interface drift")
    save(run_root / "attempt.json", {"fitAttempts":1,"evaluationAttempts":0,"rootInstruction":pin(root_instruction)} if pilot else ({"baselineAttempts":1,"rootInstruction":pin(root_instruction)} if baseline else {"smokeAttempts":1,"conditionalAll24Attempts":1,"rootInstruction":pin(root_instruction)}))
    base = profile(validate_old_output=False, repaired_metadata=(interface, repaired_plan) if repaired else None)
    if repaired:
        base.pop("adapterPlanOnlyArgv")
        base["adapterFitArgv"] = interface["argv"]
    interface = json.loads((prepared / interface_name).read_bytes())
    output = host_path(interface["writableOutput" if pilot else "replaceWritableOutput"]["hostPath"], exists=False)
    if pilot:
        require(output == prepared / "output", "Exact new pilot output required")
    require(not output.exists() or not any(output.iterdir()), "Reference output must be new/empty")
    output.mkdir(exist_ok=True)
    docker = ["docker","--context","desktop-linux"]
    calls, stages = [], []
    if not pilot: started = time.perf_counter()
    def remaining(reserve=45):
        value=(900 if pilot else 590)-(time.perf_counter()-started)-reserve
        require(value>0,"Total900s pilot deadline exhausted" if pilot else "Total600s reference deadline exhausted")
        return value
    def command(args,timeout=20,cleanup=False):
        p=subprocess.run(args,capture_output=True,text=True,timeout=min(timeout,remaining(0 if cleanup else 45)))
        calls.append({"argv":args,"exitCode":p.returncode,"stdout":p.stdout[:65536],"stderr":p.stderr[:16384]})
        require(p.returncode==0,"Reference Docker command failed: "+p.stderr[:4000])
        return p.stdout
    def inventory(cleanup=False):
        return {"containers":sorted(command([*docker,"ps","-aq","--no-trunc"],timeout=10,cleanup=cleanup).splitlines()),
                "volumes":sorted(command([*docker,"volume","ls","-q"],timeout=10,cleanup=cleanup).splitlines())}
    before=inventory();save(run_root/"before.json",before)
    require(len(before["containers"])==24 and len(before["volumes"])==14,"Exclusive reference inventory prerequisite changed")
    actual_image=json.loads(command([*docker,"image","inspect",base["imageDigest"]]))[0]
    retained=json.loads((BASE/"layer-image-inspect.json").read_bytes())
    require(all(actual_image[k]==retained[k] for k in ["Id","Config","RootFS","Descriptor"]),"Immutable reference image drift")
    smoke=None; failure=None
    try:
        for mode in (["repaired-pilot-fit"] if repaired else (["pilot-fit"] if pilot else (["experimental-baseline"] if baseline else ["smoke","development"]))):
            plan_path=prepared/("plan.json" if repaired else ("pilot-plan.json" if pilot else ("baseline-plan.json" if baseline else mode+"-plan.json")))
            require(pin(plan_path)["sha256"]==plan_pins[mode],"Frozen reference plan drift")
            plan=json.loads(plan_path.read_bytes())
            if pilot: pilot_inputs(interface, plan, repaired=repaired)
            gates=run_root/mode;gates.mkdir()
            auth_path=gates/"authorization.json"; control_path=gates/("current-process-preflight.json" if pilot else "preflight.json")
            auth={"schemaVersion":"ramp-pilot-training-authorization/1" if pilot else ("ramp-torch-baseline-authorization/2" if baseline else "ramp-torch-reference-authorization/1"),"rootThreadId":"01a0ed8a-4383-79c3-a0ae-35c1e969ef66",
                "rootAuthorized":True,"mode":mode,"planSha256":plan["planSha256"],"scriptSha256":runner_sha,
                "rootAssignmentSha256":root_sha,"rootAssignment":root_instruction.read_bytes().decode("utf-8") if repaired else root_instruction.read_text(encoding="utf-8")}
            if baseline:
                auth.update(baselinePolicy=plan["baselinePolicy"],prerequisites=plan["prerequisites"])
            if pilot:
                assignment_path = gates / "root-fit-assignment.json"
                assignment = {"schemaVersion":"ramp-pilot-root-assignment/1", "task":REPAIRED_TASK if repaired else "D07-RFDETR-PILOT-FIT-EXECUTE",
                    "rootTask":task_id, "rootThreadId":auth["rootThreadId"], "fitAuthorized":True,
                    "evaluationAuthorized":False, "planSha256":plan["planSha256"], "scriptSha256":runner_sha,
                    "modelOwnerThreadId":"01a0fbd5-4561-7692-b366-ebd123380593",
                    "rootInstruction":pin(root_instruction), "verbatimRootInstruction":auth["rootAssignment"]}
                if repaired:
                    assignment.update(lossImplementation=plan["lossImplementation"], lossDiagnostics=False)
                    auth.update(lossImplementation=plan["lossImplementation"], lossDiagnostics=False,
                        launcherSourceSha256=root_release["launcherSource"]["sha256"],
                        nativeEntrySha256=root_release["nativeEntry"]["sha256"])
                save(assignment_path, assignment)
                auth.update(scope=REPAIRED_SCOPE if repaired else "one_fixed_pilot_fit_no_evaluation", recipe=plan["trainingArguments"],
                    bounds=plan["bounds"], evidence=plan["evidence"], modelOwnerThreadId=assignment["modelOwnerThreadId"],
                    rootAssignment={**pin(assignment_path),"path":"/inputs/pilot/root-fit-assignment.json"})
            save(auth_path,auth);save(control_path,{"state":"awaiting_actual_process"})
            selected=copy.deepcopy(base);selected.update(task=run_root.name,gpuAssigned=True,output={"hostPath":str(output),"containerPath":"/outputs/rfdetr","readOnly":False,"kind":"directory"})
            selected["policy"]["deviceRequests"]=[{"DeviceIDs":[GPU_UUID],"Count":0,"Capabilities":[["gpu"]]}]
            selected["policy"].pop("attachDeadlineSeconds")
            selected["policy"].update(supervisorDeadlineSeconds=600,innerDeadlineSeconds=590,cleanupReserveSeconds=45,
                                       attachDeadline="remaining inner budget minus cleanup reserve")
            if pilot:
                selected["policy"].update(supervisorDeadlineSeconds=900,innerDeadlineSeconds=855,
                    attachDeadline="900s total budget minus elapsed and 45s cleanup reserve")
                selected.update(state="root_authorized_pilot_pending_actual_process", trainingAuthorized=True)
            extras=interface["allReadOnlyMounts"] if pilot else (interface["newReadOnlyMounts"] if baseline else interface["modes"][mode]["newReadOnlyMounts"])
            for mount in extras:
                path=host_path(mount["hostPath"],mount["kind"] if pilot else "file")
                if not pilot or "pin" in mount:
                    actual=pin(path)
                    require((actual["bytes"],actual["sha256"])==(mount["pin"]["bytes"],mount["pin"]["sha256"]),"Exact reference input pin mismatch")
            gate_prefix = "/inputs/pilot" if pilot else "/inputs/reference"
            fresh_mounts=[{"hostPath":str(auth_path),"containerPath":gate_prefix+"/authorization.json","readOnly":True,"kind":"file"},
                {"hostPath":str(control_path),"containerPath":gate_prefix+("/current-process-preflight.json" if pilot else "/preflight.json"),"readOnly":True,"kind":"file"}]
            if pilot:
                fresh_mounts.insert(1, {"hostPath":str(assignment_path),"containerPath":gate_prefix+"/root-fit-assignment.json","readOnly":True,"kind":"file"})
                require([{k:m[k] for k in ["containerPath","readOnly","kind"]} for m in fresh_mounts]
                        == [{k:m[k] for k in ["containerPath","readOnly","kind"]} for m in interface["futureRequiredReadOnlyMounts"]],
                        "Exact three pilot gate mounts required")
                selected["mounts"] = extras + fresh_mounts
            else: selected["mounts"] += extras + fresh_mounts
            if mode=="development":
                require(smoke and smoke["state"]=="reference_completed_parity_passed","ALL24 requires successful unchanged smoke")
                smoke_path=gates/"smoke-result.json";smoke_path.write_bytes((output/"reference-smoke/result.json").read_bytes())
                auth["smokeResult"]={**pin(smoke_path),"path":"/inputs/reference/smoke-result.json"}
                selected["mounts"].append({"hostPath":str(smoke_path),"containerPath":"/inputs/reference/smoke-result.json","readOnly":True,"kind":"file"})
            for index,mount in enumerate([*selected["mounts"],selected["output"]]):
                hp=host_path(mount["hostPath"],exists=False);cp=container_path(mount["containerPath"])
                for other in [*selected["mounts"],selected["output"]][:index]:
                    oh=Path(other["hostPath"]);oc=PurePosixPath(other["containerPath"])
                    require(not (hp.is_relative_to(oh) or oh.is_relative_to(hp) or cp.is_relative_to(oc) or oc.is_relative_to(cp)),"Reference mount escape/overlap refused")
            overrides = interface["runtimeRequirements"]["environmentOverrides"] if pilot else {"NVIDIA_VISIBLE_DEVICES":GPU_UUID,"CUDA_VISIBLE_DEVICES":"0"}
            selected["environment"].update(overrides)
            selected["environmentOverrides"].update(overrides)
            source=CONTROL.replace("need(not list(Path('/dev').glob('nvidia*')) and not Path('/dev/dxg').exists(),'Unexpected GPU devices in CPU profile')","# Exact physical GPU checked after current-process authorization.")
            bridge=pilot_bridge() if pilot else REFERENCE_BRIDGE.replace(REF_ROOT_SHA,root_sha)
            if baseline: bridge=bridge.replace("'--reference-run'","'--experimental-baseline-run'")
            source=source.replace("native-control.json",mode+"-native.json").replace("'gpuAssigned':False","'gpuAssigned':True").replace("actual_cpu_native_control_passed","actual_reference_native_control_passed")+bridge
            if pilot:
                source=source.replace("/inputs/plan/mounted-config.json", "/inputs/pilot/plan.json")
                source=source.replace("config.stat().st_size==52751", "config.stat().st_size==96561")
                source=source.replace(CONFIG[2], FIT_PLAN_SHA).replace("actual_reference_native_control_passed", "actual_pilot_native_control_passed")
            if repaired:
                source = repaired_native_source()
                require(hashlib.sha256(source.encode()).hexdigest() == root_release["nativeEntry"]["sha256"],
                        "Released native entry drift")
            compile(source,"<reference-current-process>","exec")
            args=base["createArgv"][:base["createArgv"].index("--mount")]
            args[args.index("--name")+1]=run_root.name+"-"+mode+"-"+uuid.uuid4().hex[:12]
            args[args.index("--label")+1]="codex.task="+run_root.name
            for key,value in selected["environmentOverrides"].items():
                positions=[i for i,arg in enumerate(args) if arg.startswith(key+"=")]
                if positions:args[positions[0]]=key+"="+value
                else:args += ["--env",key+"="+value]
            args += ["--interactive","--gpus","device="+GPU_UUID]
            for mount in [*selected["mounts"],selected["output"]]:
                args += ["--mount","type=bind,source="+mount["hostPath"]+",target="+mount["containerPath"]+(",readonly" if mount["readOnly"] else "")]
            args += [base["imageDigest"],"-I","-B","-c",source]
            selected["createArgv"]=args;selected["controlCodeSha256"]=hashlib.sha256(source.encode()).hexdigest()
            save(gates/"profile.json",selected)
            cid=None;process=None;reader=None;ready={};stage_error=None;phase_start=time.perf_counter()
            try:
                cid=command(args).strip()
                inspected=json.loads(command([*docker,"inspect",cid]))[0];validate_inspection(inspected,selected)
                save(gates/"container-readback.json",inspected)
                auth["launchObservation"]={"imageDigest":inspected["Image"],"validated":True,"mounts":[*selected["mounts"],selected["output"]],"environment":selected["environment"]}
                auth_path.write_text(json.dumps(auth,indent=2)+"\n",encoding="utf-8",newline="\n")
                channel=queue.Queue();log=gates/"container.log"
                execution_state["attempted"]=True
                process=subprocess.Popen([*docker,"start","--attach","--interactive",cid],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
                def drain():
                    with log.open("xb") as sink:
                        size=0
                        for line in iter(process.stdout.readline,b""):
                            size+=len(line)
                            if size>1024**2:channel.put(ValueError("Reference log cap exceeded"));break
                            sink.write(line);sink.flush();channel.put(line)
                    channel.put(None)
                reader=threading.Thread(target=drain,daemon=True);reader.start()
                while True:
                    line=channel.get(timeout=remaining())
                    require(line is not None,"Reference stopped before fresh authorization")
                    if isinstance(line,Exception):raise line
                    try:ready=json.loads(line)
                    except (ValueError,UnicodeDecodeError):continue
                    if ready.get("readyForAuthorization"):break
                raw=(output/(mode+"-process-preflight.json")).read_bytes()
                require(len(raw)==ready["preflightBytes"] and hashlib.sha256(raw).hexdigest()==ready["preflightSha256"],"Current preflight transport mismatch")
                require(json.loads(raw)["pid"]==ready["pid"],"Current preflight PID mismatch")
                execution_state["confirmed"]=True
                control_path.write_bytes(raw)
                auth["preflightReceipt"]={"path":fresh_mounts[-1]["containerPath"],"bytes":len(raw),"sha256":ready["preflightSha256"]}
                auth_path.write_text(json.dumps(auth,indent=2)+"\n",encoding="utf-8",newline="\n")
                process.stdin.write((json.dumps({"pid":ready["pid"],"authorizationSha256":pin(auth_path)["sha256"]})+"\n").encode());process.stdin.flush();process.stdin.close()
                exit_code=process.wait(timeout=remaining());reader.join(timeout=3)
                require(not reader.is_alive(),"Reference log reader survived")
                require(exit_code==0,"Reference worker failed; see "+str(log))
                state=json.loads(command([*docker,"inspect","--format","{{json .State}}",cid]))
                require(state["ExitCode"]==0 and not state["Running"] and not state["OOMKilled"],"Reference resource/exit failure")
                fit_folder = "repaired-pilot-fit-v1" if repaired else "pilot-fit-v1"
                result=json.loads((output/(fit_folder if pilot else Path(plan["outputDir"]).name)/"result.json").read_bytes())
                if pilot:
                    require(result["schemaVersion"]=="ramp-pilot-training-result/1" and result["state"]=="fit_completed_unqualified"
                            and result["fixedFinalCheckpoint"] is True and result["optimizerUpdates"]==36
                            and result["trainingObservations"]=={"forwardCalls":144,"trainExamples":144}
                            and result["evaluationRun"] is False and result["developmentLossHistory"]==[]
                            and result["heldOutTestOpened"] is False and result["promotion"] is False
                            and result["authorizationSha256"]==pin(auth_path)["sha256"], "Incomplete/drifted pilot result")
                    if repaired:
                        require(result["planSha256"] == plan["planSha256"] and result["task"] == interface["task"]
                                and result["lossImplementation"] == plan["lossImplementation"], "Repaired result identity drift")
                    for name, expected in result["checkpointFiles"].items():
                        actual=pin(output/fit_folder/"checkpoint"/name)
                        require((actual["bytes"],actual["sha256"])==(expected["bytes"],expected["sha256"]), "Saved pilot checkpoint pin drift")
                    require(set(result["checkpointFiles"])=={"model.safetensors","config.json","preprocessor_config.json"}, "Fixed final trio missing")
                if baseline:
                    require(result["schemaVersion"]=="ramp-torch-baseline-result/2" and result["state"]=="experimental_baseline_completed"
                            and result["scriptSha256"]==runner_sha and result["planSha256"]==plan["planSha256"]
                            and [i["id"] for i in result["items"]]==plan["selectedIds"],"Incomplete or drifted v2 result")
                if mode=="smoke":smoke=result
            except Exception as error:
                stage_error={"type":type(error).__name__,"message":str(error)}
            finally:
                if process and process.stdin and not process.stdin.closed:process.stdin.close()
                if process and process.poll() is None:process.kill();process.wait(timeout=3)
                if cid:
                    current=json.loads(command([*docker,"inspect",cid],timeout=10,cleanup=True))[0]
                    require(current["Id"]==cid and current["Config"]["Labels"].get("codex.task")==run_root.name,"Reference cleanup identity mismatch")
                    command([*docker,"rm","--force",cid],timeout=10,cleanup=True)
                if reader:
                    reader.join(timeout=3);require(not reader.is_alive(),"Reference reader survived cleanup")
                if process and process.stdout:process.stdout.close()
            stages.append({"mode":mode,"pid":ready.get("pid"),"containerId":cid,"removed":bool(cid),"elapsedSeconds":time.perf_counter()-phase_start,"failure":stage_error})
            print(json.dumps(stages[-1]),flush=True)
            if stage_error:failure=stage_error;break
            if mode=="smoke" and smoke["state"]!="reference_completed_parity_passed":
                failure={"type":"FrozenParityMiss","message":"Two-case smoke failed fixed numerical parity; ALL24 not admitted"};break
    finally:
        after=inventory(cleanup=True);require(before==after,"Reference changed retained container/volume inventory")
        save(run_root/"host-receipt.json",{"task":task_id,"status":"blocked" if failure else ("fit_completed_unqualified" if pilot else ("experimental_baseline_completed" if baseline else "all24_reference_completed")),
            "failure":failure,"stages":stages,"calls":calls,"before":before,"after":after,"elapsedSeconds":time.perf_counter()-started,"trainingAuthorized":pilot})
    if failure:raise ValueError(failure["message"])


def cached_baseline_score(root_instruction, execution_state):
    """Reuse production projection/scoring on saved outputs only, at 0.5/logit0."""
    require(root_instruction == BL_RUN / "root-assignment.txt" and pin(root_instruction)["sha256"] == BL_ROOT_SHA,
            "Exact baseline root instruction required for cached scoring")
    prepared = checked_json((BL_PREP / "baseline-plan.json", 27288, BL_PLAN_SHA))
    output = DATA / "d07-rfdetr-torch-baseline-20261005/output/experimental-baseline-v2"
    result = json.loads((output / "result.json").read_bytes())
    require(result["state"] == "experimental_baseline_completed" and result["scriptSha256"] == BL_RUNNER_SHA
            and result["planSha256"] == prepared["planSha256"]
            and [i["id"] for i in result["items"]] == prepared["selectedIds"], "Complete frozen v2 result required")
    baseline = DATA / "d07-karnataka-baseline-20261005"
    frozen = checked_json((baseline / "frozen-config.json", 155083,
                          "9b580000468c6db12e9d74a2ff25e68fa44eed289204e9fd73dd4461acbffe2c"))
    deployed = checked_json((baseline / "results.json", 173113,
                            "57becbda6d0058e1e07cca834a29965c193ec60c598d040ef2531172980b0dc1"))
    ids = prepared["selectedIds"]
    require([i["id"] for i in frozen["items"]] == ids == [i["id"] for i in deployed["items"]]
            and len(ids) == 24 and sum(i["publisherFeatureCount"] for i in frozen["items"]) == 178,
            "Original ALL24/source-label denominators required")
    for entry in frozen["sourcePins"]:
        if Path(entry["path"]).name in {"evaluate_vision_cohort.py", "spatial_ml.py", "validation.py", "ml-models.json"}:
            actual = pin(Path(entry["path"]))
            require(all(actual[k] == entry[k] for k in ("bytes", "sha256")), "Production scoring code drift")
    require(pin(Path(frozen["environment"]["lock"]["path"]))["sha256"] == frozen["environment"]["lock"]["sha256"],
            "Cached scoring environment lock drift")
    destination = BL_RUN / "scoring"
    destination.mkdir()  # One scoring attempt; retained partial output prevents replay.
    execution_state.update(attempted=True, confirmed=True)
    sys.path.insert(0, str(Path(frozen["environment"]["path"]) / "Lib/site-packages"))
    module = runpy.run_path(str(Path(__file__).with_name("compare_building_ramp.py")))
    denied = module["offline"]()
    e = module["cached_evaluator"]()  # Session and weight loaders fail closed.
    require(e.dependencies() == frozen["environment"]["dependencies"], "Cached scoring dependencies drift")
    require("torch" not in sys.modules and "onnxruntime" not in sys.modules, "Cached scoring imported a model runtime")
    items, started = [], time.perf_counter()
    for source, raw, old in zip(frozen["items"], result["items"], deployed["items"], strict=True):
        require(time.perf_counter() - started < 540, "Cached scoring deadline exceeded")
        for key in ("image", "targetMask", "scoringMask", "rawLabel"):
            e.read_pinned(source[key])
        folder = destination / source["id"].replace("/", "--"); folder.mkdir()
        archive = output / folder.name / "native-00.npz"
        require(all(pin(archive)[k] == raw["artifacts"]["native-00.npz"][k] for k in ("bytes", "sha256")),
                "Torch raw output drift")
        with e.np.load(archive, allow_pickle=False) as arrays:
            labels, scores, palette = module["cached_masks"](e, arrays["output0"], arrays["output1"], .5, 256, 256)
            candidates = int((1 / (1 + e.np.exp(-e.np.clip(arrays["output0"][0, :, 0], -80, 80))) > .5).sum())
        truth = e.np.asarray(e.Image.open(source["targetMask"]["path"])).copy()
        valid = e.np.asarray(e.Image.open(source["scoringMask"]["path"])) == 1
        require(truth.shape == (256, 256) and valid.shape == truth.shape and valid.all(), "Original full-frame scoring required")
        components, omissions = e.production._components(labels, scores, palette, source["image"]["sha256"])
        transformed = e.source_components(components, old["transform"])
        mask = (labels > 0).astype(e.np.uint8)
        polygon_mask = e.polygon_mask(transformed, 256, 256, ["background", "building"])
        objects, domain, outside = e.building_truth_objects(source, valid)
        raw_objects = [p.intersection(domain) for p in e.mask_objects(mask)]
        poly_objects = [e.shape(p["geometry"]).intersection(domain) for p in transformed]
        old_folder = baseline / "raw" / folder.name
        historical = {}
        for name in ("source-mask.png", "source-polygon-mask.png", "polygons.json"):
            entry = {**old["artifacts"][name], "path": str(old_folder / name)}
            e.read_pinned(entry); historical[name] = Path(entry["path"])
        old_mask = e.np.asarray(e.Image.open(historical["source-mask.png"]))
        old_polygon = e.np.asarray(e.Image.open(historical["source-polygon-mask.png"]))
        old_geometries = json.loads(historical["polygons.json"].read_bytes())["source"]
        item = {"id": source["id"], "task": "building", "groupId": source["groupId"], "transform": old["transform"],
            "scoredPixels": int(valid.sum()), "ignoredPixels": 0, "positiveTruthPixelsInIgnoredRegion": 0,
            "emptyTruth": not bool((truth > 0).any()), "mask": e.class_metrics(e.confusion(truth, mask, valid, 2), ["background", "building"]),
            "polygons": e.class_metrics(e.confusion(truth, polygon_mask, valid, 2), ["background", "building"]),
            "objects": {"mask": e.match_objects(objects, [p for p in raw_objects if p.area]),
                "polygons": e.match_objects(objects, [p for p in poly_objects if p.area]),
                "publisherFeatures": source["publisherFeatureCount"], "truthFeaturesOutsideScoringDomain": outside},
            "candidates": {"aboveConfidence050": candidates, "paintedInstances": len(palette) - 1},
            "polygonization": {"omissions": omissions, "returnedComponents": len(components),
                "changedScoredPixels": int((mask != polygon_mask).sum()),
                "removedForegroundPixels": int(((mask > 0) & (polygon_mask == 0)).sum()),
                "addedForegroundPixels": int(((mask == 0) & (polygon_mask > 0)).sum())},
            "deployedDisagreement": {"foregroundXorPixels": int((mask != old_mask).sum()),
                "polygonXorPixels": int((polygon_mask != old_polygon).sum()), "sourceGeometriesEqual":
                json.loads(json.dumps([p["geometry"] for p in transformed])) == [p["geometry"] for p in old_geometries]},
            "rawArchive": pin(archive)}
        require(item["emptyTruth"] == source["sourceEmpty"] == old["emptyTruth"], "Publisher-empty identity drift")
        e.Image.fromarray(mask).save(folder / "source-mask.png")
        e.Image.fromarray(polygon_mask).save(folder / "source-polygon-mask.png")
        save(folder / "polygons.json", {"processing": components, "source": transformed, "omissions": omissions})
        save(folder / "result.json", item); items.append(item)
        print(json.dumps({"scored": len(items), "id": source["id"]}), flush=True)
    empty = [i for i in items if i["emptyTruth"]]
    summary = {"task": "D07-RFDETR-TORCH-BASELINE-V2-ACTUAL", "status": "completed_cached_production050_scoring",
        "result": pin(output / "result.json"), "baselineFreeze": pin(baseline / "frozen-config.json"),
        "items": items, "aggregate": e.aggregate(items, ["background", "building"]), "deployedAggregate": deployed["aggregate"],
        "emptyScenes": {"items": len(empty), "falsePositiveScenes": sum(bool(i["mask"]["classes"][1]["fp"]) for i in empty),
            "falsePositivePixels": sum(i["mask"]["classes"][1]["fp"] for i in empty),
            "falsePositivePolygonObjects": sum(i["objects"]["polygons"]["fp"] for i in empty)},
        "omissions": {k: sum(i["polygonization"]["omissions"][k] for i in items) for k in ("small", "complex", "invalid", "capacity")},
        "deployedDisagreement": {"foregroundXorPixels": sum(i["deployedDisagreement"]["foregroundXorPixels"] for i in items),
            "polygonXorPixels": sum(i["deployedDisagreement"]["polygonXorPixels"] for i in items),
            "geometryEqualItems": sum(i["deployedDisagreement"]["sourceGeometriesEqual"] for i in items)},
        "runtime": {"seconds": time.perf_counter() - started, "newNativeModelCalls": 0, "gpuUsed": False,
            "dependencies": e.dependencies(), "pythonAuditDenials": denied, "nativeOrOsEgressAudit": False},
        "scoringPolicy": frozen["scoringPolicy"], "sourceLimitations": frozen["sourceLimitations"], "fitOrPromotion": False}
    require(len(items) == 24 and len(empty) == 5, "Incomplete ALL24 scoring")
    save(destination / "results.json", summary)
    print(json.dumps({"status": summary["status"], "items": 24, "result": pin(destination / "results.json")}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--profile", type=Path, help="Dry-validate an exact candidate; never execute it")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--torch-reference", action="store_true")
    parser.add_argument("--torch-baseline", action="store_true")
    parser.add_argument("--score-torch-baseline", action="store_true")
    parser.add_argument("--pilot-fit", action="store_true")
    parser.add_argument("--repaired-pilot-fit", action="store_true")
    parser.add_argument("--prepare-empty-loss-probe", action="store_true")
    parser.add_argument("--empty-loss-probe", action="store_true")
    parser.add_argument("--root-authorization", type=Path)
    parser.add_argument("--root-authorization-sha256", help="Exact later repaired-fit root release hash")
    parser.add_argument("--runtime-binding", type=Path)
    parser.add_argument("--readback", type=Path, help="Validate saved exact Docker inspect JSON; no Docker call")
    args = parser.parse_args()
    execution_state = {"attempted": False, "confirmed": False}
    try:
        require(sum([args.execute,args.torch_reference,args.torch_baseline,args.score_torch_baseline,args.pilot_fit,
                     args.prepare_empty_loss_probe,args.empty_loss_probe,args.repaired_pilot_fit])<=1,
                "Only one explicitly authorized execution route allowed")
        if args.repaired_pilot_fit:
            require(args.root_authorization is not None and args.root_authorization_sha256 is not None,
                    "New repaired-fit root release/hash absent; refused before execution")
            reference_checks(args.root_authorization, execution_state, pilot=True, repaired=True,
                             release_sha=args.root_authorization_sha256)
            print(json.dumps({"status":"fit_completed_unqualified","experimentExecution":True,"trainingAuthorized":True,"evaluationRun":False}))
            return
        if args.prepare_empty_loss_probe:
            prepared=prepare_empty_probe(args.root_authorization)
            save(PROBE/"prepared.json",prepared)
            print(json.dumps(prepared))
            return
        if args.empty_loss_probe:
            empty_probe_checks(args.root_authorization,execution_state)
            print(json.dumps({"status":"both_controls_finite","experimentExecution":True,"trainingAuthorized":False}))
            return
        if args.pilot_fit:
            require(args.root_authorization is not None,"Pilot fit root instruction absent; refused before execution")
            reference_checks(args.root_authorization, execution_state, pilot=True)
            print(json.dumps({"status":"fit_completed_unqualified","experimentExecution":True,"trainingAuthorized":True,"evaluationRun":False}))
            return
        if args.score_torch_baseline:
            cached_baseline_score(args.root_authorization, execution_state)
            return
        if args.torch_baseline:
            require(args.root_authorization is not None,"Baseline root instruction absent; refused before execution")
            reference_checks(args.root_authorization, execution_state, baseline=True)
            print(json.dumps({"status":"experimental_baseline_completed","experimentExecution":True,"trainingAuthorized":False}))
            return
        if args.torch_reference:
            require(args.root_authorization is not None,"Reference root instruction absent; refused before execution")
            reference_checks(args.root_authorization, execution_state)
            print(json.dumps({"status":"all24_reference_completed","experimentExecution":True,"trainingAuthorized":False}))
            return
        if args.execute:
            require(args.root_authorization is not None and args.runtime_binding is not None,
                    "Root authorization/runtime binding absent; execution refused")
            actual_checks(args.root_authorization, args.runtime_binding)
            print(json.dumps({"status":"cpu_and_tiny_gpu_controls_passed","modelsLoaded":0,"fits":0}))
            return
        require(args.plan_only, "Explicit --plan-only is required")
        expected = profile()
        if args.profile:
            validate_candidate(json.loads(args.profile.read_bytes()), expected)
        if args.readback:
            validate_inspection(json.loads(args.readback.read_bytes()), expected)
        if args.output:
            destination = host_path(args.output, exists=False)
            require(destination.parent == OUT and OUT.is_dir(), "Profile output must be in the owned task root")
            save(destination, expected)
        print(json.dumps({"status": "plan_only_metadata_validated", "readOnlyMounts": 18,
            "writableMounts": 1, "inputPinsChecked": 68, "packageVersions": len(expected["packageVersions"]),
            "imageDigest": expected["imageDigest"], "executionAuthorized": False,
            "output": str(args.output) if args.output else None}))
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired, queue.Empty) as error:
        # A post-launch failure must retain its confirmed execution scope.
        executed = True if execution_state["confirmed"] else (None if execution_state["attempted"] else False)
        print(json.dumps({"status": "blocked" if execution_state["attempted"] else "refused",
                          "reason": str(error), "experimentExecution": executed}))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
