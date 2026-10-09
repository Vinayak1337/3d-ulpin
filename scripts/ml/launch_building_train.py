"""Detach one approved, smoke-qualified training process on Windows."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-id',required=True)
    p.add_argument('--smoke-result',type=Path,required=True)
    p.add_argument('--duration-minutes',type=float,default=85)
    p.add_argument('--resume',type=Path)
    args = p.parse_args()
    if sys.platform != 'win32': raise RuntimeError('This launch helper explicitly targets Windows detachment')
    if not __import__('re').fullmatch(r'[A-Za-z0-9_-]+',args.run_id): p.error('Simple new run id required')
    smoke = json.loads(args.smoke_result.read_bytes())
    if not (smoke['status']=='passed' and smoke['optimizer_steps']==50 and
            smoke['last_20_mean_loss'] < smoke['first_20_mean_loss'] and
            smoke['peak_reserved_bytes'] <= 6*1024**3):
        raise ValueError('50-step finite/falling smoke is required before launch')
    root = Path('E:/BhuAayam-data/ml/runs') / args.run_id
    root.mkdir(parents=True,exist_ok=False)
    repo = Path(__file__).resolve().parents[2]
    script = repo / 'scripts/ml/train_buildings.py'
    command = [sys.executable,'-B','-u',str(script),'--run-id',args.run_id,
               '--duration-minutes',str(args.duration_minutes)]
    if args.resume: command += ['--resume',str(args.resume)]
    with (root / 'training.log').open('x') as log:
        child = subprocess.Popen(command,cwd=repo,stdin=subprocess.DEVNULL,
            stdout=log,stderr=subprocess.STDOUT,close_fds=True,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    receipt = {'pid':child.pid,'run_id':args.run_id,'command':command,'log':str(root / 'training.log'),
        'detached':'DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP; close_fds=True; redirected stdio',
        'smoke_result':str(args.smoke_result),'smoke_sha256':hashlib.sha256(args.smoke_result.read_bytes()).hexdigest(),
        'trainer_sha256':hashlib.sha256(script.read_bytes()).hexdigest(),
        'git_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
        'tail_command':f"Get-Content '{root / 'training.log'}' -Tail 30 -Wait"}
    with (root / 'launch.json').open('x') as f: json.dump(receipt,f,indent=2)
    print(json.dumps(receipt,indent=2))


if __name__ == '__main__': main()
