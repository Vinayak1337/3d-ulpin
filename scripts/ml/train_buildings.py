"""RAMP TRAIN-only fine-tune with standard Transformers Trainer and safe weights.

Native rfdetr 1.11.2 is pinned/importable, but the installed satellite weights
failed native inference compatibility. Its publisher's Transformers implementation
is used rather than training an unverified conversion. Every epoch is scored by
eval_buildings.py on DEV; no HOLDOUT path exists here. New output directories only.
"""
from __future__ import annotations
import os
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', OMP_NUM_THREADS='2', MKL_NUM_THREADS='2')
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys
import time
import numpy as np
from PIL import Image
from pycocotools import mask as mask_api
import torch
from torch.utils.data import Dataset
from transformers import RfDetrForInstanceSegmentation, Trainer, TrainerCallback, TrainingArguments
from rfdetr_loss import repaired_loss, require_finite, REVISION

REPO = Path(__file__).resolve().parents[2]
BASE = Path('E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original')
ROOT = Path('E:/BhuAayam-data/datasets/ramp/coco')
BUDGET = 6 * 1024**3


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()


def write_json(path, value):
    with Path(path).open('x', encoding='utf-8') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')


class RampTrain(Dataset):
    def __init__(self, smoke=False):
        self.root = ROOT / 'train'
        path = self.root / '_annotations.coco.json'
        receipt = json.loads((REPO / 'docs/evidence/gf-ai/building/data/coco-export.json').read_bytes())
        expected = next(x for x in receipt['splits'] if x['split'] == 'train')
        if sha(path) != expected['annotations_sha256']:
            raise ValueError('Frozen TRAIN annotations drift')
        coco = json.loads(path.read_bytes())
        split = json.loads((REPO / 'docs/evidence/gf-ai/building/split/split.json').read_bytes())
        if sorted(x['source_id'] for x in coco['images']) != split['splits']['train']['chip_ids']:
            raise ValueError('TRAIN chip identities drift')
        self.annotations = defaultdict(list)
        for a in coco['annotations']: self.annotations[a['image_id']].append(a)
        self.images = coco['images']
        if smoke:
            # Bounded overfit probe includes empty and dense real TRAIN inputs.
            empty = [x for x in self.images if not self.annotations[x['id']]][:2]
            dense = [x for x in self.images if len(self.annotations[x['id']]) >= 15][:2]
            positive = [x for x in self.images if self.annotations[x['id']] and x not in dense][:4]
            self.images = empty + dense + positive
        self.smoke = smoke
        self.binding = {'split':'train','coco_sha256':sha(path),'chips':len(self.images),
            'publisher_features':sum(len(self.annotations[x['id']]) for x in self.images),
            'empty_chips':sum(not self.annotations[x['id']] for x in self.images),
            'chip_ids': [x['source_id'] for x in self.images] if smoke else None,
            'split_chip_ids_sha256':split['splits']['train']['chip_ids_sha256']}

    def __len__(self): return len(self.images)

    def __getitem__(self, index):
        item = self.images[index]
        image = Image.open(self.root / item['file_name']).convert('RGB')
        if hashlib.sha256(np.asarray(image).tobytes()).hexdigest() != item['rgb_pixel_sha256']:
            raise ValueError('TRAIN source pixels drift')
        w, h = image.size
        if w > 512 or h > 512:
            raise ValueError('TRAIN chip exceeds production single-tile size; explicit tile export required')
        rgb = torch.from_numpy(np.asarray(image.resize((432,432), Image.Resampling.BILINEAR)).copy()).permute(2,0,1).float() / 255
        boxes, masks = [], []
        for a in self.annotations[item['id']]:
            rle = a['segmentation']
            raw = mask_api.decode(mask_api.frPyObjects(rle,*rle['size']))
            masks.append(torch.from_numpy(np.asarray(Image.fromarray(raw).resize((432,432), Image.Resampling.NEAREST)).copy()).float())
            x,y,bw,bh = a['bbox']
            boxes.append([(x+bw/2)/w,(y+bh/2)/h,bw/w,bh/h])
        boxes = torch.tensor(boxes,dtype=torch.float32).reshape(-1,4)
        masks = torch.stack(masks) if masks else torch.empty((0,432,432))
        # Zero-pixel publisher masks remain present, including their box/class.
        if not self.smoke:
            if random.random() < .5:
                rgb, masks = rgb.flip(-1), masks.flip(-1)
                boxes[:,0] = 1-boxes[:,0]
            if random.random() < .5:
                rgb, masks = rgb.flip(-2), masks.flip(-2)
                boxes[:,1] = 1-boxes[:,1]
        rgb = (rgb - torch.tensor([.485,.456,.406])[:,None,None]) / torch.tensor([.229,.224,.225])[:,None,None]
        return {'pixel_values':rgb,'labels':{'class_labels':torch.zeros(len(boxes),dtype=torch.int64),'boxes':boxes,'masks':masks}}


def collate(rows):
    return {'pixel_values':torch.stack([x['pixel_values'] for x in rows]), 'labels':[x['labels'] for x in rows]}


class FiniteTrainer(Trainer):
    def __init__(self, *args, journal, **kwargs):
        super().__init__(*args, **kwargs)
        self.journal = journal
        self.micro_losses = []

    def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
        result = model(**inputs)
        require_finite(result.loss, result.loss_dict)
        if model.training:
            value = float(result.loss.detach())
            self.micro_losses.append(value)
            self.journal.write(json.dumps({'event':'micro_step','optimizer_step':self.state.global_step,
                'loss':value,'at':datetime.now(timezone.utc).isoformat(),
                'peak_reserved_bytes':torch.cuda.max_memory_reserved()})+'\n')
        return (result.loss,result) if return_outputs else result.loss


class DevEpochs(TrainerCallback):
    def __init__(self, output, train_args, smoke, duration_minutes):
        self.output, self.train_args, self.smoke = output, train_args, smoke
        self.start = time.monotonic()
        self.duration = duration_minutes * 60
        self.best_f1, self.bad_epochs = -1., 0
        self.results = []
        if train_args.get('resume'):
            # Preserve high-water mark/patience across resumable segments. Read
            # only original DEV decisions, never another split's results.
            previous = Path(train_args['resume']).parent / 'dev-selection.jsonl'
            if not previous.is_file():
                raise ValueError('Resume requires the original DEV selection journal')
            records = [json.loads(x) for x in previous.read_text().splitlines()]
            if records:
                self.best_f1 = max(x['dev_f1'] for x in records)
                self.bad_epochs = records[-1]['bad_epochs']
        self.trainer = None

    def on_pre_optimizer_step(self, args, state, control, model=None, **kwargs):
        if any(p.grad is not None and not torch.isfinite(p.grad).all() for p in model.parameters()):
            raise FloatingPointError('Non-finite unscaled gradients: stop before optimizer')
        if torch.cuda.max_memory_reserved() > BUDGET:
            raise RuntimeError('Training exceeded 6 GiB reserved-memory budget')

    def on_epoch_end(self, args, state, control, model=None, optimizer=None, **kwargs):
        if self.smoke: return control
        epoch = round(state.epoch)
        if epoch < 1: return control
        checkpoint = self.output / f'epoch-{epoch:03d}'
        checkpoint.mkdir(exist_ok=False)
        model.save_pretrained(checkpoint, safe_serialization=True)
        # Standard Trainer resume state. Model weights always safetensors;
        # optimiser/scheduler state are local trusted Trainer-generated files.
        self.trainer._save_optimizer_and_scheduler(str(checkpoint))
        self.trainer._save_scaler(str(checkpoint))
        self.trainer._save_rng_state(str(checkpoint))
        state.save_to_json(str(checkpoint / 'trainer_state.json'))
        write_json(checkpoint / 'training-config.json', self.train_args)
        # Free the parent's GPU state during the evaluator subprocess. No two
        # GPU model owners run concurrently; restore each optimizer tensor device.
        original_devices = []
        model.to('cpu')
        for values in optimizer.state.values():
            for k,v in list(values.items()):
                if torch.is_tensor(v) and v.is_cuda:
                    original_devices.append((values,k,v.device))
                    values[k] = v.cpu()
        torch.cuda.empty_cache()
        run_id = self.output.name + f'-epoch{epoch:03d}-dev-t050'
        command = [sys.executable,'-B','-u',str(REPO / 'scripts/ml/eval_buildings.py'),
            '--model',str(checkpoint),'--split','dev','--provider','cuda','--run-id',run_id]
        try:
            with (self.output / f'epoch-{epoch:03d}-dev.log').open('x') as log:
                subprocess.run(command,cwd=REPO,stdout=log,stderr=subprocess.STDOUT,check=True)
            result = json.loads((REPO / 'docs/evidence/gf-ai/building' / run_id / 'result.json').read_bytes())
            m = result['metrics']['per_building']
            f1 = 2*m['tp']/(2*m['tp']+m['fp']+m['fn'])
            improved = f1 > self.best_f1 + .001
            self.bad_epochs = 0 if improved else self.bad_epochs+1
            if improved: self.best_f1 = f1
            entry = {'epoch':epoch,'checkpoint':str(checkpoint),'dev_run_id':run_id,
                'dev_f1':f1,'precision':m['precision'],'recall':m['recall'],
                'empty_fp':result['metrics']['false_buildings_on_empty'],
                'improved':improved,'bad_epochs':self.bad_epochs,
                'peak_reserved_bytes':torch.cuda.max_memory_reserved()}
            self.results.append(entry)
            with (self.output / 'dev-selection.jsonl').open('a') as journal:
                journal.write(json.dumps(entry)+'\n')
            print(json.dumps({'event':'epoch_dev',**entry}),flush=True)
        finally:
            model.to('cuda')
            for values,k,device in original_devices: values[k] = values[k].to(device)
        # Stop only at a fully checkpointed epoch/DEV boundary, never at a partial
        # gradient accumulation window. Up to 100 minutes per resumable segment.
        if self.bad_epochs >= 3 or time.monotonic()-self.start >= self.duration:
            control.should_training_stop = True
        return control


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-id',required=True)
    p.add_argument('--smoke',action='store_true')
    p.add_argument('--duration-minutes',type=float,default=85)
    p.add_argument('--resume',type=Path)
    args = p.parse_args()
    if not __import__('re').fullmatch(r'[A-Za-z0-9_-]+',args.run_id): p.error('Simple unique run-id required')
    output = Path('E:/BhuAayam-data/ml/runs') / args.run_id
    # Launch helper creates log directory only; existing training records deny rerun.
    output.mkdir(parents=True,exist_ok=True)
    if (output / 'run-config.json').exists(): raise FileExistsError('Preserve every run; use a new id')
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    random.seed(26011)
    np.random.seed(26011)
    torch.cuda.set_per_process_memory_fraction(.75)
    dataset = RampTrain(args.smoke)
    recipe = {'framework':'Transformers Trainer / RF-DETR segmentation','base':str(BASE),
        'base_sha256':sha(BASE / 'model.safetensors'),'seed':26011,'batch_size':1,
        'gradient_accumulation_steps':4,'learning_rate_heads':1e-4,'learning_rate_backbone':1e-5,
        'amp':'bf16','max_epochs':12,'early_stopping':'DEV polygon F1, min_delta .001, patience 3',
        'preprocessing':'production RGB Pillow bilinear 432; ImageNet; source tiles <=512; stride384',
        'augmentation':'TRAIN horizontal/vertical flips only; smoke none',
        'zero_pixel_masks':'Retained; box/class and zero mask supervised; no relabel/drop',
        'loss_revision':REVISION,'data':dataset.binding,'resume':str(args.resume) if args.resume else None,
        'git_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),
        'smoke':args.smoke,'holdout_calls':0,'duration_minutes':args.duration_minutes}
    write_json(output / 'run-config.json',recipe)
    model = RfDetrForInstanceSegmentation.from_pretrained(args.resume or BASE,
        local_files_only=True,use_safetensors=True,attn_implementation='eager')
    model.loss_function = repaired_loss()
    model.to('cuda')
    groups = [
        {'params':[v for k,v in model.named_parameters() if 'backbone' not in k and v.requires_grad],'lr':1e-4},
        {'params':[v for k,v in model.named_parameters() if 'backbone' in k and v.requires_grad],'lr':1e-5}]
    optimizer = torch.optim.AdamW(groups,weight_decay=1e-4)
    training = TrainingArguments(output_dir=str(output / 'trainer'),
        max_steps=50 if args.smoke else -1,num_train_epochs=12,
        per_device_train_batch_size=1,gradient_accumulation_steps=4,
        learning_rate=1e-4,weight_decay=1e-4,lr_scheduler_type='constant',
        bf16=True,seed=26011,data_seed=26011,dataloader_num_workers=0,
        dataloader_pin_memory=False,remove_unused_columns=False,
        save_strategy='no',eval_strategy='no',logging_steps=10,
        report_to='none',disable_tqdm=True,max_grad_norm=.1,
        logging_nan_inf_filter=False)
    callback = DevEpochs(output,recipe,args.smoke,args.duration_minutes)
    with (output / 'steps.jsonl').open('x',buffering=1) as journal:
        trainer = FiniteTrainer(model=model,args=training,train_dataset=dataset,
            data_collator=collate,optimizers=(optimizer,None),callbacks=[callback],journal=journal)
        callback.trainer = trainer
        started = time.monotonic()
        try:
            trainer.train(resume_from_checkpoint=str(args.resume) if args.resume else None)
            first = float(np.mean(trainer.micro_losses[:20]))
            last = float(np.mean(trainer.micro_losses[-20:]))
            result = {'status':'passed' if not args.smoke or last < first else 'failed_loss_not_falling',
                'optimizer_steps':trainer.state.global_step,'micro_steps':len(trainer.micro_losses),
                'first_20_mean_loss':first,'last_20_mean_loss':last,
                'peak_allocated_bytes':torch.cuda.max_memory_allocated(),
                'peak_reserved_bytes':torch.cuda.max_memory_reserved(),
                'budget_bytes':BUDGET,'seconds':time.monotonic()-started,
                'dev_epochs':callback.results,'holdout_calls':0,'run_config_sha256':sha(output / 'run-config.json')}
            model.save_pretrained(output / 'segment-final',safe_serialization=True)
            write_json(output / 'result.json',result)
            print(json.dumps(result),flush=True)
            if result['status'] != 'passed': raise SystemExit(1)
        except BaseException as error:
            write_json(output / 'failure.json',{'error':str(error),'type':type(error).__name__,
                'optimizer_step':trainer.state.global_step,'micro_steps':len(trainer.micro_losses),
                'peak_reserved_bytes':torch.cuda.max_memory_reserved(),'holdout_calls':0})
            raise


if __name__ == '__main__': main()
