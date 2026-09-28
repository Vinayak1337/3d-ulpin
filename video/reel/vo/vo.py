"""Voice-over for the reel: Kokoro v1.0 (Apache-2.0), a blend of am_michael and am_onyx, rendered locally.
Setup (outside the repo): a Python 3.10+ venv with kokoro-onnx and soundfile, kokoro-v1.0.onnx and voices-v1.0.bin
from github.com/thewh1teagle/kokoro-onnx releases (model-files-v1.0), and the espeak-ng-data folder copied to a short path.
  KOKORO_DIR=<dir with model files> ESPEAK_DATA=<short espeak-ng-data path> python vo.py
Writes vNN.wav (24 kHz mono, silence trimmed) and durations.json next to this file."""
import json, os, pathlib
import numpy as np, soundfile as sf, espeakng_loader
from kokoro_onnx import Kokoro, EspeakConfig

here = pathlib.Path(__file__).parent
kd = pathlib.Path(os.environ['KOKORO_DIR'])
k = Kokoro(str(kd / 'kokoro-v1.0.onnx'), str(kd / 'voices-v1.0.bin'),
           espeak_config=EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=os.environ['ESPEAK_DATA']))
voice = 0.6 * k.get_voice_style('am_michael') + 0.4 * k.get_voice_style('am_onyx')
SPEED = {'v30': 0.8, 'v31': 0.8, 'v32': 0.78, 'v33': 0.82, 'v03': 0.82, 'v02': 0.85}

def trim(a, sr, pad=0.03):
    env = np.convolve(np.abs(a), np.ones(240) / 240, 'same'); on = np.where(env > 0.004)[0]
    if not len(on): return a
    i, j = max(0, on[0] - int(pad * sr)), min(len(a), on[-1] + int(pad * sr) * 3)
    out = a[i:j].copy(); f = int(0.012 * sr); out[:f] *= np.linspace(0, 1, f); out[-f:] *= np.linspace(1, 0, f)
    return out

durs = {}
for line in json.loads((here / 'lines.json').read_text()):
    a, sr = k.create(line['say'], voice=voice, speed=SPEED.get(line['id'], 0.9), lang='en-us')
    a = trim(a, sr)
    sf.write(here / f"{line['id']}.wav", a, sr, subtype='PCM_16')
    durs[line['id']] = round(len(a) / sr, 3)
    print(line['id'], durs[line['id']], line['say'])
(here / 'durations.json').write_text(json.dumps(durs, indent=1))
