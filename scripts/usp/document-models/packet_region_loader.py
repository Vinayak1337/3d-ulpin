"""Leaf-local verified source loader and frozen, resolved runtime inventory.

No package/global cache is changed. Repository/package Python is compiled from
the exact verified source snapshot; native/runtime files stay read-locked.
"""
from __future__ import annotations
import hashlib
import importlib.abc
import importlib.machinery
import json
import os
from pathlib import Path
import sys
import sysconfig
import types

REPO_FILES = ["services/geo/geo/usp_packet_regions.py", "scripts/usp/document-models/run_packet_region.py",
              "scripts/usp/document-models/packet_region_loader.py", "scripts/usp/document-models/run_trial.py",
              "scripts/usp/document-models/run_pdf_pages.py", "services/geo/geo/usp_document_candidates/granite.py",
              "services/geo/geo/__init__.py", "services/geo/geo/usp_document_candidates/__init__.py",
              "packages/contracts/src/packet-region.ts"]
EXTENSIONS = {".py", ".pyc", ".pyd", ".dll", ".exe", ".zip", ".pth", "._pth", ".cfg"}
EXCLUDED = {"site-packages", "test", "tests", "idlelib", "tkinter", "turtledemo", "__pycache__"}
CONTEXT = None


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024), b""):
            h.update(block)
    return h.hexdigest()


def inventory(root, exclude_stdlib=False, all_files=False):
    result = []
    for path in Path(root).rglob("*"):
        relative = path.relative_to(root)
        # Runtime bytecode is also pinned, including bootstrap dependencies.
        omitted = EXCLUDED - {"__pycache__"} if exclude_stdlib else set()
        if path.is_file() and (all_files or path.suffix.lower() in EXTENSIONS) and not any(p in omitted for p in relative.parts):
            result.append(path.resolve())
    return sorted(result)


def build_profile(repo: Path, output: Path, purelib: Path | None = None):
    repo = repo.resolve()
    purelib = (purelib or Path(sysconfig.get_paths()["purelib"])).resolve()
    base = Path(sys.base_prefix).resolve()
    roots = [(base/"Lib", True, False), (base/"DLLs", False, False)]
    roots += [(purelib/name, False, True) for name in ("pypdfium2", "pypdfium2_raw", "pypdfium2_cfg", "pymupdf", "fitz", "PIL", "psutil")]
    files = {path for root, excluded, all_files in roots if root.exists() for path in inventory(root, excluded, all_files)}
    files.update(path.resolve() for path in base.iterdir() if path.is_file() and path.suffix.lower() in EXTENSIONS)
    executable_dir = Path(sys.executable).resolve().parent
    files.update(path.resolve() for path in executable_dir.iterdir() if path.is_file() and path.suffix.lower() in EXTENSIONS)
    venv_config = executable_dir.parent / "pyvenv.cfg"
    if venv_config.is_file():
        files.add(venv_config.resolve())
    files.update([Path(sys.executable).resolve(), Path(sys._base_executable).resolve()])
    files.update(repo/path for path in REPO_FILES)
    # Distribution metadata is consulted by the renderer; bind the resolved files.
    for name in ("pypdfium2", "pymupdf", "pillow", "psutil"):
        for directory in purelib.glob(name+"-*.dist-info"):
            files.update(path.resolve() for path in directory.iterdir() if path.is_file())
    entries = [{"path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)} for path in sorted(files)]
    if len(entries) > 5000 or sum(e["bytes"] for e in entries) > 512*1024**2:
        raise RuntimeError("PACKET_REGION_RUNTIME_PROFILE_LIMIT")
    profile = {"version": "packet-region-runtime/1", "repo": str(repo), "python": str(Path(sys.executable).resolve()),
               "purelib": str(purelib), "base": str(base), "repoFiles": REPO_FILES, "files": entries}
    encoded = (json.dumps(profile, sort_keys=True, separators=(",", ":"))+"\n").encode()
    if len(encoded) > 1024**2:
        raise RuntimeError("PACKET_REGION_RUNTIME_PROFILE_LIMIT")
    with output.open("xb") as stream:
        stream.write(encoded)
    return hashlib.sha256(encoded).hexdigest()


class VerifiedLoader(importlib.machinery.SourceFileLoader):
    def get_code(self, fullname):
        path = str(Path(self.path).resolve())
        source = CONTEXT["sources"].get(path)
        if source is None:
            raise RuntimeError("PACKET_REGION_UNPINNED_IMPORT")
        return compile(source, path, "exec")


class VerifiedFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        if spec is None or spec.origin in (None, "built-in", "frozen"):
            return spec
        origin = str(Path(spec.origin).resolve())
        if origin not in CONTEXT["files"]:
            raise RuntimeError("PACKET_REGION_UNPINNED_IMPORT")
        if isinstance(spec.loader, importlib.machinery.SourceFileLoader):
            spec.loader = VerifiedLoader(fullname, origin)
        elif not isinstance(spec.loader, importlib.machinery.ExtensionFileLoader):
            raise RuntimeError("PACKET_REGION_UNPINNED_IMPORT")
        return spec


def activate(profile_path, expected_sha):
    global CONTEXT
    raw = Path(profile_path).read_bytes()
    if len(raw) > 1024**2 or hashlib.sha256(raw).hexdigest() != expected_sha:
        raise RuntimeError("PACKET_REGION_RUNTIME_PROFILE_DRIFT")
    profile = json.loads(raw)
    if (CONTEXT or profile.get("version") != "packet-region-runtime/1" or profile.get("repoFiles") != REPO_FILES or
            not 1 <= len(profile["files"]) <= 5000 or
            sum(entry["bytes"] for entry in profile["files"]) > 512*1024**2):
        raise RuntimeError("PACKET_REGION_RUNTIME_PROFILE_INVALID")
    locks, sources, files = [], {}, {}
    try:
        if os.name != "nt":
            raise RuntimeError("PACKET_REGION_RUNTIME_UNAVAILABLE")
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                                      ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        kernel.CreateFileW.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        for entry in profile["files"]:
            path = Path(entry["path"])
            if (str(path.resolve()) != entry["path"] or str(path) in files or not path.is_file() or
                    not 0 <= entry["bytes"] <= 32*1024**2 or path.stat().st_size != entry["bytes"]):
                raise RuntimeError("PACKET_REGION_EXECUTABLE_DRIFT")
            # Share-read only: keep resolved native/source/cache bytes immutable
            # throughout this local process's execution and its supervised child.
            handle = kernel.CreateFileW(str(path), 0x80000000, 1, None, 3, 0x80, None)
            if handle in (None, ctypes.c_void_p(-1).value):
                raise RuntimeError("PACKET_REGION_EXECUTABLE_LOCK_FAILED")
            locks.append(handle)
            source = path.read_bytes() if path.suffix == ".py" else None
            observed = hashlib.sha256(source).hexdigest() if source is not None else digest(path)
            if observed != entry["sha256"]:
                raise RuntimeError("PACKET_REGION_EXECUTABLE_DRIFT")
            files[str(path)] = entry
            if source is not None:
                sources[str(path)] = source
        for relative in REPO_FILES:
            if str(Path(profile["repo"])/relative) not in files:
                raise RuntimeError("PACKET_REGION_RUNTIME_PROFILE_INVALID")
        for executable in (sys.executable, sys._base_executable):
            if str(Path(executable).resolve()) not in files:
                raise RuntimeError("PACKET_REGION_EXECUTABLE_DRIFT")
        # Bootstrap stdlib imports have already run. The host verifies their
        # source/cache/native bytes before startup, and these locks retain them.
        for module in list(sys.modules.values()):
            origin = getattr(module, "__file__", None)
            if origin and str(Path(origin).resolve()) not in files:
                raise RuntimeError("PACKET_REGION_UNPINNED_IMPORT")
        CONTEXT = {"profile": profile, "sha256": expected_sha, "sources": sources, "files": files,
                   "locks": locks, "kernel": kernel}
        sys.dont_write_bytecode = True
        sys.path[:] = [str(Path(profile["repo"])/"services/geo"), str(Path(profile["repo"])/"scripts/usp/document-models"),
                       profile["purelib"], str(Path(profile["base"])/"Lib"), str(Path(profile["base"])/"DLLs")]
        sys.meta_path.insert(0, VerifiedFinder())
    except BaseException:
        CONTEXT = None
        for handle in locks:
            kernel.CloseHandle(handle)
        raise


def close():
    global CONTEXT
    sys.meta_path[:] = [finder for finder in sys.meta_path if not isinstance(finder, VerifiedFinder)]
    if CONTEXT:
        for handle in CONTEXT["locks"]:
            CONTEXT["kernel"].CloseHandle(handle)
    CONTEXT = None


def recipe_hash(repo):
    if not CONTEXT or Path(repo).resolve() != Path(CONTEXT["profile"]["repo"]):
        raise RuntimeError("PACKET_REGION_EXECUTION_UNVERIFIED")
    return CONTEXT["sha256"]


def source_module(name, relative):
    path = str(Path(CONTEXT["profile"]["repo"])/relative)
    module = types.ModuleType(name)
    module.__file__ = path
    module.__package__ = name.rpartition(".")[0]
    sys.modules[name] = module
    exec(compile(CONTEXT["sources"][path], path, "exec"), module.__dict__)
    return module


def supervisor():
    module = source_module("run_trial", "scripts/usp/document-models/run_trial.py")
    loader = str(Path(CONTEXT["profile"]["repo"])/"scripts/usp/document-models/packet_region_loader.py")
    expected = CONTEXT["files"][loader]["sha256"]
    # Adapt only the local loaded gate. The accepted Job/tree/timeout algorithm
    # and shared source file are unchanged; no site/.pth code is initialized.
    module._WINDOWS_GATE = "if __import__('sys').stdin.buffer.read(1)!=b'1': raise SystemExit(3)\n" + bootstrap(loader, expected)
    # The shared supervisor's isolated launch has no -B. Add it through this
    # module's private subprocess binding, before interpreter initialization,
    # so even a missing bootstrap cache cannot cause a global cache write.
    original_popen = module.subprocess.Popen
    private_subprocess = types.ModuleType("packet_region_subprocess")
    private_subprocess.__dict__.update(module.subprocess.__dict__)

    def popen(command, *args, **kwargs):
        if command[:5] != [sys._base_executable, "-I", "-S", "-c", module._WINDOWS_GATE]:
            raise RuntimeError("PACKET_REGION_SUPERVISOR_LAUNCH_DRIFT")
        return original_popen([*command[:3], "-B", *command[3:]], *args, **kwargs)

    private_subprocess.Popen = popen
    module.subprocess = private_subprocess
    return module._run_worker


def bootstrap(loader, expected):
    return ("import sys\nsys.dont_write_bytecode=True\nimport hashlib,types\n"
            "p="+repr(loader)+"\nb=open(p,'rb').read(262145)\n"
            "if len(b)>262144 or hashlib.sha256(b).hexdigest()!="+repr(expected)+": raise SystemExit(5)\n"
            "m=types.ModuleType('packet_region_loader');m.__file__=p;sys.modules[m.__name__]=m\n"
            "exec(compile(b,p,'exec'),m.__dict__)\n"
            "m.run_entry(sys.argv[1:])\n")


def run_entry(arguments):
    profile_path = arguments[arguments.index("--profile")+1]
    profile_sha = arguments[arguments.index("--profile-sha256")+1]
    activate(profile_path, profile_sha)
    try:
        # The shared supervisor includes its executable before the script.
        if str(Path(arguments[0]).resolve()) == CONTEXT["profile"]["python"]:
            arguments = arguments[1:]
        entry, args = arguments[0], arguments[1:]
        expected = str(Path(CONTEXT["profile"]["repo"])/"scripts/usp/document-models/run_packet_region.py")
        if str(Path(entry).resolve()) != expected:
            raise RuntimeError("PACKET_REGION_ENTRY_DRIFT")
        sys.argv = [expected, *args]
        source_module("__main__", "scripts/usp/document-models/run_packet_region.py")
    finally:
        close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-profile", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--purelib", type=Path)
    args = parser.parse_args()
    print(build_profile(args.repo, args.create_profile, args.purelib))
