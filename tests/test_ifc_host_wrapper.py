"""Targeted Windows wrapper controls; retained source, existing pinned runtime, no services."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import psutil

ROOT=Path(__file__).resolve().parents[1]
PRIVATE=Path(os.environ.get('ULPIN_IFC_TEST_ROOT','E:/BhuAayam-data/task-data/desktop-ifc-native'))
PROFILE=PRIVATE/'api-checks/profile.json'
available=os.name=='nt' and PROFILE.exists() and (PRIVATE/'api-checks/worker-local-process.txt').exists()


@unittest.skipUnless(available,'requires retained Windows IFC profile and worker receipt')
class HostWrapper(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile=json.loads(PROFILE.read_bytes())
        receipt=Path(os.environ.get('ULPIN_IFC_TEST_RECEIPT',str(PRIVATE/'api-checks/worker-local-process.txt')))
        cls.tools=next(json.loads(line)['pins'] for line in receipt.read_text().splitlines() if line.startswith('{"localProcess"'))
        cls.wrapper=ROOT/'scripts/usp/ifc/server.py'
        spec=importlib.util.spec_from_file_location('ifc_host_wrapper',cls.wrapper)
        cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)

    def command(self,*args):
        return [self.profile['python'],'-I','-S','-B',str(self.wrapper),*args]

    def environment(self,scratch):
        return {'SystemRoot':os.environ['SystemRoot'],'TEMP':str(scratch),'TMP':str(scratch)}

    def request(self,scratch,tools=None):
        source=PRIVATE/'originals/ifc2x3-building-architecture.ifc'
        request=scratch/'request.json'
        request.write_text(json.dumps({'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'output':str(scratch/'native.json'),'profilePath':str(PROFILE),'tools':tools or self.tools}))
        return request

    def test_busy_refuses_without_native_launch(self):
        with tempfile.TemporaryDirectory(dir=self.profile['scratchRoot'],prefix='ifc-busy-control-') as name:
            scratch=Path(name);request=self.request(scratch)
            with self.module.host_lock():
                result=subprocess.run(self.command('--request',str(request)),env=self.environment(scratch),capture_output=True,timeout=10)
            self.assertEqual(result.returncode,2);self.assertEqual(json.loads(result.stdout),{'code':'IFC_BUSY'})
            self.assertFalse((scratch/'native.json').exists())

    def test_cancel_reaps_actual_parser_before_new_host_capacity(self):
        with tempfile.TemporaryDirectory(dir=self.profile['scratchRoot'],prefix='ifc-cancel-control-') as name:
            scratch=Path(name);request=self.request(scratch)
            child=subprocess.Popen(self.command('--request',str(request)),env=self.environment(scratch),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            parser=None
            try:
                until=time.monotonic()+25
                while time.monotonic()<until and child.poll() is None:
                    descendants=psutil.Process(child.pid).children()
                    if descendants:
                        self.assertEqual(len(descendants),1);parser=descendants[0];break
                    time.sleep(.005)
                self.assertIsNotNone(parser,'control must observe the actual parser, not only configuration hashing')
                child.kill();child.communicate(timeout=5)
                reaped=subprocess.run(self.command('--reap-pid',str(child.pid)),env=self.environment(scratch),capture_output=True,timeout=6)
                self.assertEqual(reaped.returncode,0,reaped.stdout);self.assertEqual(json.loads(reaped.stdout),{'state':'available'})
                self.assertFalse(parser.is_running())
                self.assertFalse((scratch/'native.json').exists())
                with self.module.host_lock():pass
            finally:
                if child.poll() is None:child.kill();child.communicate(timeout=5)
            print(json.dumps({'cancelledSupervisorPid':child.pid,'observedParserPid':parser.pid,'parserReaped':True,'hostLockAvailable':True}))

    def test_profile_drift_is_controlled_and_never_publishes(self):
        with tempfile.TemporaryDirectory(dir=self.profile['scratchRoot'],prefix='ifc-drift-control-') as name:
            scratch=Path(name);request=self.request(scratch,{**self.tools,'profileSha256':'0'*64})
            result=subprocess.run(self.command('--request',str(request)),env=self.environment(scratch),capture_output=True,timeout=10)
            self.assertEqual(result.returncode,2);self.assertEqual(json.loads(result.stdout),{'code':'IFC_TOOL_CHANGED'})
            self.assertFalse((scratch/'native.json').exists())


if __name__=='__main__':unittest.main()
