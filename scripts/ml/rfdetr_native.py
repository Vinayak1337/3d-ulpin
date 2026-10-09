"""Pinned native RF-DETR adapter for the installed, safe satellite checkpoint.

The publisher file already has native RF-DETR state-dict names. Only its
single-channel classification heads need the native background-slot convention.
No backbone or building-channel parameter is randomly reinitialised.
"""
from pathlib import Path
import importlib.metadata
import json
import torch
from safetensors.torch import load_file, save_file

BASE = Path('E:/BhuAayam-data/task-data/d07-rfdetr-train-prep-20261005/original')


def model_config():
    from rfdetr.config import RFDETRSegMediumConfig
    if importlib.metadata.version('rfdetr') != '1.11.2':
        raise RuntimeError('Native adapter requires pinned rfdetr 1.11.2')
    return RFDETRSegMediumConfig(pretrain_weights=None, num_classes=1,
        resolution=432, device='cuda', gradient_checkpointing=True)


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
        # Extra native background slot: deterministic no-object logit -10.
        # The satellite building row is copied exactly. It remains class zero.
        extra = torch.zeros_like(value) if key.endswith('weight') else torch.full_like(value, -10.)
        state[key] = torch.cat([value, extra], dim=0)
        expanded.append(key)
    model.load_state_dict(state, strict=True)
    return expanded


def load_native(path, device='cpu'):
    from rfdetr.models.lwdetr import build_model_from_config
    from rfdetr.config import RFDETRSegMediumConfig
    config = RFDETRSegMediumConfig(**json.loads((Path(path) / 'native-config.json').read_text()))
    config.device = device
    config.pretrain_weights = None
    model = build_model_from_config(config)
    model.load_state_dict(load_file(str(Path(path) / 'model.safetensors')), strict=True)
    return model.to(device).eval()


def outputs(model, tensor):
    result = model(tensor)
    return result['pred_logits'][..., :1], result['pred_boxes'], result['pred_masks']


def save_native(model, config, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    save_file({k: v.detach().cpu().contiguous().clone() for k, v in model.state_dict().items()},
              str(output / 'model.safetensors'))
    (output / 'native-config.json').write_text(config.model_dump_json(indent=2) + '\n')


def check_base(output):
    """Bounded native-vs-installed-PyTorch comparison on TRAIN, never HOLDOUT."""
    import numpy as np
    from PIL import Image
    from transformers import RfDetrForInstanceSegmentation
    from rfdetr.models.lwdetr import build_model_from_config
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    torch.cuda.set_per_process_memory_fraction(.75)
    root = Path('E:/BhuAayam-data/datasets/ramp/coco/train')
    coco = json.loads((root / '_annotations.coco.json').read_bytes())
    image = coco['images'][0]
    rgb = np.asarray(Image.open(root / image['file_name']).convert('RGB').resize((432,432), Image.Resampling.BILINEAR)).astype('float32') / 255
    rgb = (rgb - np.array([.485,.456,.406],dtype='float32')) / np.array([.229,.224,.225],dtype='float32')
    x = torch.from_numpy(rgb.transpose(2,0,1).copy())[None].cuda()
    native = build_model_from_config(model_config()).cuda().eval()
    expanded = load_satellite(native)
    hf = RfDetrForInstanceSegmentation.from_pretrained(BASE, local_files_only=True, use_safetensors=True, attn_implementation='eager').cuda().eval()
    with torch.inference_mode():
        a, b, c = outputs(native, x)
        ref = hf(pixel_values=x)
    differences = {'logits':float((a-ref.logits).abs().max()), 'boxes':float((b-ref.pred_boxes).abs().max()), 'masks':float((c-ref.pred_masks).abs().max())}
    passed = all(v <= .002 for v in differences.values())
    result = {'status':'passed' if passed else 'failed', 'chip_id':image['source_id'], 'split':'train', 'expanded_class_heads':expanded, 'max_abs_difference':differences, 'tolerance':.002, 'holdout_calls':0}
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).open('x').write(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--check-base', type=Path, required=True)
    check_base(p.parse_args().check_base)
