"""Choose completed Karnataka checkpoints/thresholds on DEV only, never HOLDOUT.

Use CPU while detached Run 1 owns CUDA. This is a provisional selection; the lead
fixes the final candidate after training. Three prespecified thresholds only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / 'docs/evidence/gf-ai/building'


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def f1(m): return 2*m['tp']/(2*m['tp']+m['fp']+m['fn'])


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-id',required=True)
    p.add_argument('--selection-id',required=True)
    args=p.parse_args()
    for value in [args.run_id,args.selection_id]:
        if not __import__('re').fullmatch(r'[A-Za-z0-9_-]+',value): p.error('Simple new ids required')
    run=Path('E:/BhuAayam-data/ml/runs') / args.run_id
    entries=[json.loads(x) for x in (run / 'dev-selection.jsonl').read_text().splitlines()]
    if not entries: raise ValueError('No completed epoch DEV receipt; leave training alone')
    output=EVIDENCE / args.selection_id
    output.mkdir(exist_ok=False)
    # Choose among completed epochs using the same .5 polygon-F1 objective used
    # by training/early stopping; never use visual inspection or held-out scores.
    epoch=max(entries,key=lambda x:(x['dev_f1'],-x['epoch']))
    checkpoint=Path(epoch['checkpoint'])
    baseline=json.loads((EVIDENCE / 'b1-installed-dev-20261010/result.json').read_bytes())
    base=baseline['metrics']['per_building']
    plan={'schema':'building-dev-selection/1','status':'started','run_id':args.run_id,
        'checkpoint':str(checkpoint),'checkpoint_sha256':sha(checkpoint / 'model.safetensors'),
        'completed_epoch_records':entries,'thresholds':[.3,.5,.7],
        'selection_rule':'Prefer a threshold meeting preregistered precision>=.75 and recall>=.70; otherwise highest production polygon F1, precision tie-break.',
        'baseline_dev_precision':base['precision'],'baseline_dev_recall':base['recall'],
        'baseline_dev_f1':f1(base),'baseline_empty_fp':baseline['metrics']['false_buildings_on_empty'],
        'provisional':True,'final_candidate_fixed':False,'holdout_calls':0,
        'git_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()}
    with (output / 'plan.json').open('x') as f: json.dump(plan,f,indent=2)
    results=[]
    for threshold in plan['thresholds']:
        if threshold==.5:
            run_id=epoch['dev_run_id']
        else:
            run_id=args.selection_id + '-t' + str(round(threshold*100)).zfill(3)
            command=[sys.executable,'-B','-u',str(REPO / 'scripts/ml/eval_buildings.py'),
                '--model',str(checkpoint),'--split','dev','--provider','cpu',
                '--score-threshold',str(threshold),'--run-id',run_id]
            with (run / (run_id+'.log')).open('x') as log:
                subprocess.run(command,cwd=REPO,stdout=log,stderr=subprocess.STDOUT,check=True)
        result=json.loads((EVIDENCE / run_id / 'result.json').read_bytes())
        if result['split']!='dev' or result['model']['sha256']!=plan['checkpoint_sha256'] or result['coverage']['completed_chips']!=1434:
            raise ValueError('DEV receipt/checkpoint/coverage binding drift')
        m=result['metrics']['per_building']
        results.append({'threshold':threshold,'run_id':run_id,'result_sha256':sha(EVIDENCE / run_id / 'result.json'),
            'precision':m['precision'],'recall':m['recall'],'f1':f1(m),
            'empty_fp':result['metrics']['false_buildings_on_empty'],
            'gate_thresholds_met':m['precision']>=.75 and m['recall']>=.70})
    best=max(results,key=lambda x:(x['gate_thresholds_met'],x['f1'],x['precision']))
    result={**plan,'status':'completed','threshold_results':results,'chosen':best,
        'beats_baseline_dev_f1':best['f1']>plan['baseline_dev_f1'],
        'precision_delta':best['precision']-base['precision'],
        'recall_delta':best['recall']-base['recall'],
        'empty_fp_delta':best['empty_fp']['buildings']-plan['baseline_empty_fp']['buildings'],
        'production_threshold_version_change_required':best['threshold']!=.5,
        'note':'No HOLDOUT attempt 2; a non-.5 threshold is DEV-only until the lead approves/binds the final profile. Training may produce a better later checkpoint.'}
    with (output / 'result.json').open('x') as f: json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps(result,indent=2),flush=True)


if __name__=='__main__': main()
