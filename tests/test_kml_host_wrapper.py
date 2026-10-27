"""KML-only Windows busy/cancel controls using retained bytes and accepted runtime."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import ctypes
from ctypes import wintypes

ROOT=Path(__file__).resolve().parents[1]
PRIVATE=Path(os.environ.get('ULPIN_KML_PROOF_ROOT','E:/BhuAayam-data/task-data/desktop-kml-private-api'))
PROFILE=Path(os.environ.get('ULPIN_KML_PROFILE',str(PRIVATE/'profile-initial.json')))
JOURNEY=PRIVATE/'journey-initial/kmlsamples.kml.journey.json'
available=os.name=='nt' and PROFILE.exists() and JOURNEY.exists()

def windows_process_api():
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    class Entry(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),
                  ('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),
                  ('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('exe',wintypes.WCHAR*260)]
    kernel.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
    kernel.Process32FirstW.argtypes=kernel.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    def children(parent):
        snapshot=kernel.CreateToolhelp32Snapshot(2,0)
        if snapshot==ctypes.c_void_p(-1).value:raise OSError('snapshot_failed')
        entry=Entry();entry.size=ctypes.sizeof(entry);pids=[]
        try:
            more=kernel.Process32FirstW(snapshot,ctypes.byref(entry))
            while more:
                if entry.parent==parent:pids.append(entry.pid)
                more=kernel.Process32NextW(snapshot,ctypes.byref(entry))
        finally:kernel.CloseHandle(snapshot)
        return pids
    return kernel,children

@unittest.skipUnless(available,'requires Windows KML profile and actual worker journey')
class HostWrapper(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile=json.loads(PROFILE.read_bytes())
        cls.tools=json.loads(JOURNEY.read_bytes())['pins']
        cls.wrapper=ROOT/'scripts/usp/kml/server.py'
        spec=importlib.util.spec_from_file_location('kml_host_wrapper',cls.wrapper)
        cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)

    def command(self,*args):
        return [self.profile['python'],'-I','-S','-B',str(self.wrapper),*args]

    def environment(self,scratch):
        return {'SystemRoot':os.environ['SystemRoot'],'TEMP':str(scratch),'TMP':str(scratch)}

    def request(self,scratch):
        source=Path(os.environ.get('ULPIN_KML_TEST_ROOT','E:/BhuAayam-data/task-data/desktop-kml-native'))/'originals/kmlsamples.kml'
        request=scratch/'request.json'
        request.write_text(json.dumps({'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'member':None,'output':str(scratch/'native.json'),'profilePath':str(PROFILE),'tools':self.tools}))
        return request

    def test_busy_refuses_without_native_launch(self):
        with tempfile.TemporaryDirectory(dir=self.profile['scratchRoot'],prefix='kml-busy-control-') as name:
            scratch=Path(name);request=self.request(scratch)
            with self.module.host_lock():
                result=subprocess.run(self.command('--request',str(request)),env=self.environment(scratch),capture_output=True,timeout=10)
            self.assertEqual(result.returncode,2);self.assertEqual(json.loads(result.stdout),{'code':'KML_BUSY'})
            self.assertFalse((scratch/'native.json').exists())

    def test_cancel_reaps_actual_parser_before_new_host_capacity(self):
        with tempfile.TemporaryDirectory(dir=self.profile['scratchRoot'],prefix='kml-cancel-control-') as name:
            scratch=Path(name);request=self.request(scratch)
            child=subprocess.Popen(self.command('--request',str(request)),env=self.environment(scratch),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            parser=None;parser_handle=None;kernel,children=windows_process_api()
            try:
                until=time.monotonic()+20
                while time.monotonic()<until and child.poll() is None:
                    descendants=children(child.pid)
                    if descendants:
                        self.assertEqual(len(descendants),1);parser=descendants[0]
                        parser_handle=kernel.OpenProcess(0x100000,False,parser);self.assertTrue(parser_handle);break
                    time.sleep(.002)
                self.assertIsNotNone(parser,'observe the actual parser, not only configuration hashing')
                child.kill();child.communicate(timeout=5)
                reaped=subprocess.run(self.command('--reap-pid',str(child.pid)),env=self.environment(scratch),capture_output=True,timeout=6)
                self.assertEqual(reaped.returncode,0,reaped.stdout);self.assertEqual(json.loads(reaped.stdout),{'state':'available'})
                self.assertEqual(kernel.WaitForSingleObject(parser_handle,0),0);self.assertFalse((scratch/'native.json').exists())
                with self.module.host_lock():pass
            finally:
                if child.poll() is None:child.kill();child.communicate(timeout=5)
                if parser_handle:kernel.CloseHandle(parser_handle)
            print(json.dumps({'cancelledSupervisorPid':child.pid,'observedParserPid':parser,'parserReaped':True,'hostLockAvailable':True}))

if __name__=='__main__':unittest.main()
