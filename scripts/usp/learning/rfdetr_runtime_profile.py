"""Prepare a sealed RF-DETR profile; separately authorized bounded checks only.

Metadata readiness is separate from actual runtime, model, GPU and fit admission.
The historical authorization admits CPU processor and tiny GPU controls.
A separate exact root instruction admits the frozen Torch reference, with
current-process gates and conditional ALL24. There is no fitting entry point.
The e71d historical control and its single-use launcher remain unchanged.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import queue
import subprocess
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


def profile(validate_old_output=True):
    interface, cfg, binding = sealed_inputs(validate_old_output)
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
        "runtimeBindingPin": pin(BINDING[0]), "interfacePin": pin(INTERFACE[0]),
        "mountedConfigPin": pin(CONFIG[0]), "mountedPlanPin": pin(PLAN[0]),
        "imageDigest": binding["imageDigest"], "imageConfigDigest": binding["imageConfigDigest"],
        "python": binding["pythonExecutable"], "packageVersions": binding["packageVersions"],
        "mounts": interface["mounts"], "output": interface["output"], "inventoryFiles": 68,
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
            and config["Cmd"] == expected["createArgv"][-4:]
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


def reference_checks(root_instruction, execution_state):
    require(root_instruction == REF_RUN / "root-assignment.txt"
            and pin(root_instruction)["sha256"] == REF_ROOT_SHA, "Exact reference root instruction required")
    require(pin(REF / "compare_ramp_torch.py")["sha256"] == REF_RUNNER_SHA
            and pin(REF / "mount-interface.json")["sha256"] == REF_INTERFACE_SHA, "Reference runner/interface drift")
    save(REF_RUN / "attempt.json", {"smokeAttempts":1,"conditionalAll24Attempts":1,"rootInstruction":pin(root_instruction)})
    base = profile(validate_old_output=False)
    interface = json.loads((REF / "mount-interface.json").read_bytes())
    output = host_path(interface["replaceWritableOutput"]["hostPath"], exists=False)
    require(not output.exists() or not any(output.iterdir()), "Reference output must be new/empty")
    output.mkdir(exist_ok=True)
    docker = ["docker","--context","desktop-linux"]
    calls, stages, started = [], [], time.perf_counter()
    def remaining(reserve=45):
        value=590-(time.perf_counter()-started)-reserve
        require(value>0,"Total600s reference deadline exhausted")
        return value
    def command(args,timeout=20,cleanup=False):
        p=subprocess.run(args,capture_output=True,text=True,timeout=min(timeout,remaining(0 if cleanup else 45)))
        calls.append({"argv":args,"exitCode":p.returncode,"stdout":p.stdout[:65536],"stderr":p.stderr[:16384]})
        require(p.returncode==0,"Reference Docker command failed: "+p.stderr[:4000])
        return p.stdout
    def inventory(cleanup=False):
        return {"containers":sorted(command([*docker,"ps","-aq","--no-trunc"],timeout=10,cleanup=cleanup).splitlines()),
                "volumes":sorted(command([*docker,"volume","ls","-q"],timeout=10,cleanup=cleanup).splitlines())}
    before=inventory();save(REF_RUN/"before.json",before)
    require(len(before["containers"])==24 and len(before["volumes"])==14,"Exclusive reference inventory prerequisite changed")
    actual_image=json.loads(command([*docker,"image","inspect",base["imageDigest"]]))[0]
    retained=json.loads((BASE/"layer-image-inspect.json").read_bytes())
    require(all(actual_image[k]==retained[k] for k in ["Id","Config","RootFS","Descriptor"]),"Immutable reference image drift")
    smoke=None; failure=None
    try:
        for mode in ["smoke","development"]:
            require(pin(REF/(mode+"-plan.json"))["sha256"]==REF_PLANS[mode],"Frozen reference plan drift")
            plan=json.loads((REF/(mode+"-plan.json")).read_bytes())
            gates=REF_RUN/mode;gates.mkdir()
            auth_path=gates/"authorization.json"; control_path=gates/"preflight.json"
            auth={"schemaVersion":"ramp-torch-reference-authorization/1","rootThreadId":"01a0ed8a-4383-79c3-a0ae-35c1e969ef66",
                "rootAuthorized":True,"mode":mode,"planSha256":plan["planSha256"],"scriptSha256":REF_RUNNER_SHA,
                "rootAssignmentSha256":REF_ROOT_SHA,"rootAssignment":root_instruction.read_text(encoding="utf-8")}
            save(auth_path,auth);save(control_path,{"state":"awaiting_actual_process"})
            selected=copy.deepcopy(base);selected.update(task=REF_RUN.name,gpuAssigned=True,output={"hostPath":str(output),"containerPath":"/outputs/rfdetr","readOnly":False,"kind":"directory"})
            selected["policy"]["deviceRequests"]=[{"DeviceIDs":[GPU_UUID],"Count":0,"Capabilities":[["gpu"]]}]
            selected["policy"].pop("attachDeadlineSeconds")
            selected["policy"].update(supervisorDeadlineSeconds=600,innerDeadlineSeconds=590,cleanupReserveSeconds=45,
                                       attachDeadline="remaining inner budget minus cleanup reserve")
            extras=interface["modes"][mode]["newReadOnlyMounts"]
            for mount in extras:
                path=host_path(mount["hostPath"],"file");actual=pin(path)
                require((actual["bytes"],actual["sha256"])==(mount["pin"]["bytes"],mount["pin"]["sha256"]),"Exact reference input pin mismatch")
            selected["mounts"]+=extras+[{"hostPath":str(auth_path),"containerPath":"/inputs/reference/authorization.json","readOnly":True,"kind":"file"},
                {"hostPath":str(control_path),"containerPath":"/inputs/reference/preflight.json","readOnly":True,"kind":"file"}]
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
            selected["environment"].update(NVIDIA_VISIBLE_DEVICES=GPU_UUID,CUDA_VISIBLE_DEVICES="0")
            selected["environmentOverrides"].update(NVIDIA_VISIBLE_DEVICES=GPU_UUID,CUDA_VISIBLE_DEVICES="0")
            source=CONTROL.replace("need(not list(Path('/dev').glob('nvidia*')) and not Path('/dev/dxg').exists(),'Unexpected GPU devices in CPU profile')","# Exact physical GPU checked after current-process authorization.")
            source=source.replace("native-control.json",mode+"-native.json").replace("'gpuAssigned':False","'gpuAssigned':True").replace("actual_cpu_native_control_passed","actual_reference_native_control_passed")+REFERENCE_BRIDGE
            compile(source,"<reference-current-process>","exec")
            args=base["createArgv"][:base["createArgv"].index("--mount")]
            args[args.index("--name")+1]=REF_RUN.name+"-"+mode+"-"+uuid.uuid4().hex[:12]
            args[args.index("--label")+1]="codex.task="+REF_RUN.name
            for i,value in enumerate(args):
                if value.startswith("NVIDIA_VISIBLE_DEVICES="):args[i]="NVIDIA_VISIBLE_DEVICES="+GPU_UUID
                if value.startswith("CUDA_VISIBLE_DEVICES="):args[i]="CUDA_VISIBLE_DEVICES=0"
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
                auth["preflightReceipt"]={"path":"/inputs/reference/preflight.json","bytes":len(raw),"sha256":ready["preflightSha256"]}
                auth_path.write_text(json.dumps(auth,indent=2)+"\n",encoding="utf-8",newline="\n")
                process.stdin.write((json.dumps({"pid":ready["pid"],"authorizationSha256":pin(auth_path)["sha256"]})+"\n").encode());process.stdin.flush();process.stdin.close()
                exit_code=process.wait(timeout=remaining());reader.join(timeout=3)
                require(not reader.is_alive(),"Reference log reader survived")
                require(exit_code==0,"Reference worker failed; see "+str(log))
                state=json.loads(command([*docker,"inspect","--format","{{json .State}}",cid]))
                require(state["ExitCode"]==0 and not state["Running"] and not state["OOMKilled"],"Reference resource/exit failure")
                result=json.loads((output/Path(plan["outputDir"]).name/"result.json").read_bytes())
                if mode=="smoke":smoke=result
            except Exception as error:
                stage_error={"type":type(error).__name__,"message":str(error)}
            finally:
                if process and process.stdin and not process.stdin.closed:process.stdin.close()
                if process and process.poll() is None:process.kill();process.wait(timeout=3)
                if cid:
                    current=json.loads(command([*docker,"inspect",cid],timeout=10,cleanup=True))[0]
                    require(current["Id"]==cid and current["Config"]["Labels"].get("codex.task")==REF_RUN.name,"Reference cleanup identity mismatch")
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
        save(REF_RUN/"host-receipt.json",{"task":"D07-RFDETR-TORCH-REFERENCE","status":"blocked" if failure else "all24_reference_completed",
            "failure":failure,"stages":stages,"calls":calls,"before":before,"after":after,"elapsedSeconds":time.perf_counter()-started,"trainingAuthorized":False})
    if failure:raise ValueError(failure["message"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--profile", type=Path, help="Dry-validate an exact candidate; never execute it")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--torch-reference", action="store_true")
    parser.add_argument("--root-authorization", type=Path)
    parser.add_argument("--runtime-binding", type=Path)
    parser.add_argument("--readback", type=Path, help="Validate saved exact Docker inspect JSON; no Docker call")
    args = parser.parse_args()
    execution_state = {"attempted": False, "confirmed": False}
    try:
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
    except (ValueError, OSError, KeyError) as error:
        # A post-launch failure must retain its confirmed execution scope.
        executed = True if execution_state["confirmed"] else (None if execution_state["attempted"] else False)
        print(json.dumps({"status": "blocked" if execution_state["attempted"] else "refused",
                          "reason": str(error), "experimentExecution": executed}))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
