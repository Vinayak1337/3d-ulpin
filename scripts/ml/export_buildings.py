"""Export a safe RF-DETR checkpoint and score ONNX/PyTorch parity on 20 DEV chips.

CPU-only so the detached training process remains the exclusive GPU owner.
ONNX has exactly production's two outputs: logits, masks. A retained parity graph
exposes a third boxes output solely for the requested numerical box comparison.
Both graphs are checked; production outputs are compared on every parity chip.
"""
import os
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',OMP_NUM_THREADS='2',MKL_NUM_THREADS='2')
import argparse
from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import time
import numpy as np
from PIL import Image
import torch
from transformers import RfDetrForInstanceSegmentation

REPO = Path(__file__).resolve().parents[2]


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tensor(path):
    image = Image.open(path).convert('RGB')
    array = np.asarray(image.resize((432,432),Image.Resampling.BILINEAR)).transpose(2,0,1).astype('float32') / 255
    array = (array-np.array([.485,.456,.406],dtype='float32')[:,None,None])/np.array([.229,.224,.225],dtype='float32')[:,None,None]
    return array[None].copy()


class Export(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model
    def forward(self, image):
        output = self.model(pixel_values=image)
        return output.logits, output.pred_masks, output.pred_boxes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--run-id',required=True)
    p.add_argument('--ort-no-optimizations',action='store_true',help='Bounded parity diagnosis: ORT_DISABLE_ALL')
    p.add_argument('--reuse-parity-graph',type=Path,help='Diagnose exactly retained graph bytes, without re-export')
    args = p.parse_args()
    if not __import__('re').fullmatch(r'[A-Za-z0-9_-]+',args.run_id): p.error('Simple new run-id required')
    output = Path('E:/BhuAayam-data/ml/runs') / args.run_id
    output.mkdir(parents=True,exist_ok=False)
    torch.set_num_threads(2)
    torch.manual_seed(26011)
    import onnx
    import onnxruntime as ort
    root = Path('E:/BhuAayam-data/datasets/ramp/coco/dev')
    path = root / '_annotations.coco.json'
    receipt = json.loads((REPO / 'docs/evidence/gf-ai/building/data/coco-export.json').read_bytes())
    if sha(path) != next(x for x in receipt['splits'] if x['split']=='dev')['annotations_sha256']:
        raise ValueError('Frozen DEV annotations drift')
    coco = json.loads(path.read_bytes())
    counts = Counter(a['image_id'] for a in coco['annotations'])
    empty = [x for x in coco['images'] if counts[x['id']]==0][:4]
    dense = [x for x in coco['images'] if counts[x['id']]>=15][:4]
    selected = empty + dense
    selected += [x for x in coco['images'] if x not in selected][:20-len(selected)]
    if len(selected)!=20: raise ValueError('Parity requires exactly 20 DEV chips')
    model = RfDetrForInstanceSegmentation.from_pretrained(args.checkpoint,local_files_only=True,
        use_safetensors=True,attn_implementation='eager').cpu().eval()
    wrapper = Export(model).eval()
    debug = output / 'building-parity-boxes.onnx'
    start = time.monotonic()
    # Eager RF-DETR returns its learned PE directly at the pinned 432 grid.
    # During tracing upstream unnecessarily resamples that *same* grid using
    # aten::_upsample_bicubic2d_aa (unsupported by legacy ONNX). Preserve eager
    # semantics locally; this export is deliberately static 1x3x432x432 only.
    from types import MethodType
    from transformers.models.rf_detr.modeling_rf_detr import RfDetrDinov2Embeddings
    embeddings = [m for m in model.modules() if isinstance(m,RfDetrDinov2Embeddings)]
    if len(embeddings)!=1 or embeddings[0].position_embeddings.shape[1]!=1297:
        raise ValueError('Static 432 positional-embedding contract drift')
    embedding = embeddings[0]
    original = embedding.interpolate_pos_encoding
    def fixed_grid(self, values, height, width):
        return self.position_embeddings
    if args.reuse_parity_graph:
        import shutil
        shutil.copyfile(args.reuse_parity_graph,debug)
    else:
        embedding.interpolate_pos_encoding = MethodType(fixed_grid,embedding)
        try:
            with torch.inference_mode():
                torch.onnx.export(wrapper,torch.from_numpy(tensor(root / selected[0]['file_name'])),
                    str(debug),input_names=['image'],output_names=['logits','masks','boxes'],
                    opset_version=17,dynamo=False,external_data=False)
        finally:
            embedding.interpolate_pos_encoding = original
    graph = onnx.load(str(debug))
    onnx.checker.check_model(graph)
    primary = copy.deepcopy(graph)
    del primary.graph.output[2:]
    production = output / 'building.onnx'
    onnx.save(primary,str(production))
    onnx.checker.check_model(primary)
    options = ort.SessionOptions()
    options.intra_op_num_threads=2
    options.inter_op_num_threads=1
    if args.ort_no_optimizations:
        options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(str(debug),options,providers=['CPUExecutionProvider'])
    serving = ort.InferenceSession(str(production),options,providers=['CPUExecutionProvider'])
    rows=[]
    maxima={'logits':0.,'masks':0.,'boxes':0.,'production_vs_parity_logits':0.,'production_vs_parity_masks':0.}
    with torch.inference_mode():
        for chip in selected:
            source = Image.open(root / chip['file_name']).convert('RGB')
            if hashlib.sha256(np.asarray(source).tobytes()).hexdigest()!=chip['rgb_pixel_sha256']:
                raise ValueError('DEV source pixels drift')
            x=tensor(root / chip['file_name'])
            pytorch=[v.numpy() for v in wrapper(torch.from_numpy(x))]
            exported=session.run(None,{'image':x})
            actual=serving.run(None,{'image':x})
            differences={name:float(np.max(np.abs(a-b))) for name,a,b in zip(['logits','masks','boxes'],pytorch,exported)}
            differences.update(production_vs_parity_logits=float(np.max(np.abs(actual[0]-exported[0]))),
                production_vs_parity_masks=float(np.max(np.abs(actual[1]-exported[1]))))
            for k,v in differences.items(): maxima[k]=max(maxima[k],v)
            rows.append({'chip_id':chip['source_id'],'publisher_features':counts[chip['id']],
                'empty':counts[chip['id']]==0,'max_abs_difference':differences,
                'mask_sign_disagreement_pixels':int(np.count_nonzero((pytorch[1]>0)!=(exported[1]>0)))})
    passed=maxima['logits']<=.001 and maxima['masks']<=.001 and maxima['boxes']<=.0001 and maxima['production_vs_parity_logits']<=.001 and maxima['production_vs_parity_masks']<=.001
    result={'schema':'building-onnx-parity/1','status':'passed' if passed else 'failed',
        'checkpoint':str(args.checkpoint),'checkpoint_sha256':sha(args.checkpoint / 'model.safetensors'),
        'onnx_path':str(production),'onnx_sha256':sha(production),
        'parity_graph':str(debug),'parity_graph_sha256':sha(debug),
        'box_comparison':'Same graph with a third debug output; production graph removes only that output, retains identical learned parameters. Production logits/masks also compared on all 20 chips.',
        'split':'dev','dev_annotations_sha256':sha(path),'chips':20,
        'profile':'RGB432/Pillow bilinear/ImageNet float32; production tile512 stride384',
        'max_abs_difference':maxima,'tolerance':{'logits':.001,'masks':.001,'boxes':.0001},
        'per_chip':rows,'seconds':time.monotonic()-start,'providers':['CPUExecutionProvider'],
        'opset':17,'static_input_shape':[1,3,432,432],
        'ort_optimization':'ORT_DISABLE_ALL' if args.ort_no_optimizations else 'ORT_ENABLE_ALL',
        'export_repair':'Instance-local fixed-grid PE matches eager 432 path; original interpolation restored before all PyTorch parity references',
        'holdout_calls':0,'git_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()}
    with (output / 'result.json').open('x') as f: json.dump(result,f,indent=2,allow_nan=False)
    evidence=REPO / 'docs/evidence/gf-ai/building' / args.run_id
    evidence.mkdir(exist_ok=False)
    with (evidence / 'result.json').open('x') as f: json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps(result),flush=True)
    if not passed: raise SystemExit(1)


if __name__=='__main__': main()
