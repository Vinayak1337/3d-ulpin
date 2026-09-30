"""No-service OS controls. Starts only harmless owned Python sleepers, never validators."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SUPERVISOR = Path(__file__).resolve().parents[1] / 'scripts/usp/cityjson-validity'
sys.path.insert(0, str(SUPERVISOR))
import server


def running(pid):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
    finally:
        kernel.CloseHandle(handle)


@unittest.skipUnless(os.name == 'nt', 'Pinned native profile supports Windows only')
class SupervisorControls(unittest.TestCase):
    def test_killed_supervisor_cleans_child_and_grandchild(self):
        child_code = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)']); print(p.pid,flush=True);time.sleep(30)"
        code = (f"import sys,subprocess,json,time;sys.path.insert(0,{str(SUPERVISOR)!r});import server;"
                f"job=server.own_process_tree();p=subprocess.Popen([sys.executable,'-I','-c',{child_code!r}],stdout=subprocess.PIPE,text=True);"
                "grandchild=int(p.stdout.readline());print(json.dumps([p.pid,grandchild]),flush=True);time.sleep(30)")
        parent = subprocess.Popen([sys.executable, '-I', '-B', '-c', code], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            line = parent.stdout.readline()
            self.assertTrue(line, parent.stderr.read() if parent.poll() is not None else 'missing owned child identities')
            identities = json.loads(line)
            self.assertTrue(all(running(pid) for pid in identities))
            parent.kill()
            parent.wait(timeout=5)
            deadline = time.monotonic() + 3
            while any(running(pid) for pid in identities) and time.monotonic() < deadline:
                time.sleep(0.025)
            self.assertFalse(any(running(pid) for pid in identities))
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=5)
            parent.stdout.close()
            parent.stderr.close()

    def test_host_lock_excludes_peer_and_releases_after_crash(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = f"import sys;sys.path.insert(0,{str(SUPERVISOR)!r});import server;from pathlib import Path;"
            peer = prefix + "\ntry:\n with server.host_lock(): print('acquired')\nexcept server.Busy: print('busy')"
            with server.host_lock():
                result = subprocess.run([sys.executable, '-I', '-B', '-c', peer], capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), 'busy')
            owner_code = prefix + "import time\nwith server.host_lock():\n print('locked',flush=True)\n time.sleep(30)"
            owner = subprocess.Popen([sys.executable, '-I', '-B', '-c', owner_code], stdout=subprocess.PIPE, text=True,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                self.assertEqual(owner.stdout.readline().strip(), 'locked')
                owner.kill()
                owner.wait(timeout=5)
            finally:
                if owner.poll() is None:
                    owner.kill()
                    owner.wait(timeout=5)
                owner.stdout.close()
            result = subprocess.run([sys.executable, '-I', '-B', '-c', peer], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'acquired')


if __name__ == '__main__':
    unittest.main()
