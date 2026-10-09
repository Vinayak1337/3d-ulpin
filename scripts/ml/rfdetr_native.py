"""Pinned native RF-DETR adapter for the installed, safe satellite checkpoint.

Diagnostic only: NOT a qualified training/inference adapter. The native package
and publisher implementation share weight keys, but failed strict inference
parity on empty TRAIN chips. Retain the failure and one background-slot comparison;
do not silently train this conversion. No learned parameter is reinitialised.
"""
from pathlib import Path
import importlib.metadata
import json
import torch
from safetensors.torch import load_file

BASE = Path('E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original')


def model_config(device='cuda'):
    from rfdetr.config import RFDETRSegMediumConfig
    if importlib.metadata.version('rfdetr') != '1.11.2':
        raise RuntimeError('Native adapter requires pinned rfdetr 1.11.2')
    return RFDETRSegMediumConfig(pretrain_weights=None, num_classes=1,
        resolution=432, device=device, gradient_checkpointing=True)


def load_satellite(model, path=BASE / 'model.safetensors'):
    state = load_file(str(path))
    expected = model.state_dict()
    if set(expected) - set(state) != {'_kp_active_mask'} or set(state) - set(expected):
        raise ValueError('Satellite/native state keys drifted')
    state['_kp_active_mask'] = expected['_kp_active_mask']
    expanded = []
    for key, value in list(state.items()):
        if value.shape == expected[key].shape:
            continue
        if 'class_embed' not in key or value.shape[0] != 1 or expected[key].shape[0] != 2:
            raise ValueError('Unexpected weight shape: ' + key)
        # Extra native background slot must NEVER outrank building proposals.
        # -10 was too high on empty chips and changed encoder TopK. Use -10000;
        # the satellite building row is copied exactly and remains class zero.
        extra = torch.zeros_like(value) if key.endswith('weight') else torch.full_like(value, -10000.)
        state[key] = torch.cat([value, extra], dim=0)
        expanded.append(key)
    model.load_state_dict(state, strict=True)
    return expanded


def outputs(model, tensor):
    result = model(tensor)
    return result['pred_logits'][..., :1], result['pred_boxes'], result['pred_masks']


def check_base(output, device):
    """Bounded native-vs-installed-PyTorch comparison on TRAIN, never HOLDOUT."""
    import numpy as np
    from PIL import Image
    from transformers import RfDetrForInstanceSegmentation
    from rfdetr.models.lwdetr import build_model_from_config
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    if device=='cuda': torch.cuda.set_per_process_memory_fraction(.75)
    root = Path('E:/BhuAayam-data/datasets/ramp/coco/train')
    coco = json.loads((root / '_annotations.coco.json').read_bytes())
    positive_ids = {a['image_id'] for a in coco['annotations']}
    selected = [next(x for x in coco['images'] if x['id'] not in positive_ids),
                next(x for x in coco['images'] if x['id'] in positive_ids)]
    native = build_model_from_config(model_config(device)).to(device).eval()
    expanded = load_satellite(native)
    hf = RfDetrForInstanceSegmentation.from_pretrained(BASE, local_files_only=True, use_safetensors=True, attn_implementation='eager').to(device).eval()
    rows=[]
    for image in selected:
        rgb = np.asarray(Image.open(root / image['file_name']).convert('RGB').resize((432,432), Image.Resampling.BILINEAR)).astype('float32') / 255
        rgb = (rgb - np.array([.485,.456,.406],dtype='float32')) / np.array([.229,.224,.225],dtype='float32')
        x = torch.from_numpy(rgb.transpose(2,0,1).copy())[None].to(device)
        with torch.inference_mode():
            a, b, c = outputs(native, x)
            ref = hf(pixel_values=x)
        differences = {'logits':float((a-ref.logits).abs().max()), 'boxes':float((b-ref.pred_boxes).abs().max()), 'masks':float((c-ref.pred_masks).abs().max())}
        rows.append({'chip_id':image['source_id'],'empty':image['id'] not in positive_ids,'max_abs_difference':differences})
    passed = all(v <= .002 for row in rows for v in row['max_abs_difference'].values())
    result = {'status':'passed' if passed else 'failed', 'device':device,'per_chip':rows, 'split':'train', 'expanded_class_heads':expanded, 'background_slot_bias':-10000.,'tolerance':.002, 'holdout_calls':0}
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).open('x').write(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--check-base', type=Path, required=True)
    p.add_argument('--device',choices=['cpu','cuda'],default='cpu')
    args=p.parse_args()
    check_base(args.check_base,args.device)
