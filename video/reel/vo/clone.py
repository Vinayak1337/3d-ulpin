"""Narration for the reel in the founder's own voice, cloned locally on Apple Silicon through mlx-audio by one of two
engines: Qwen3-TTS 1.7B Base or Chatterbox (both Apache-2.0).

The reference is the founder reading a short passage (REF_TEXT). It is personal and stays out of the repository:
by default it is read from ~/.cache/bhuaayam-vo/voice/ref.wav (set VOICE_REF to use another file). Record it
quietly, 20 to 35 seconds, at a natural pace.

Each passage is recorded until a take passes two checks: Whisper hears the passage's own words, starting and ending
on them, and the pace is natural. All passages then share one gain, so the narrator sits at LEVEL in the mix.

Setup (outside the repo): a Python 3.11 venv with mlx-audio, mlx-whisper and soundfile, plus ffmpeg on PATH.
Models download from Hugging Face on first use (see ENGINES), plus mlx-community/whisper-small-mlx.
The script writes "BhuAayam" and "ULPIN"; each engine gets the spelling it pronounces best.
ElevenLabs reads its API key from ~/.config/elevenlabs/key (created by the account holder, never by this script), uploads
the reference once as a voice named "BhuAayam narrator" and remembers its id in ~/.cache/bhuaayam-vo/eleven-voice.json.
Sarvam clones the same reference in Indian English (voices/create, then voices/clone with Bulbul) with the key in the
SARVAM_API_KEY environment variable, and remembers the voice id in ~/.cache/bhuaayam-vo/sarvam-voice.json.
Takes are cached in ~/.cache/bhuaayam-vo/clone, keyed by the engine, the text, the reference and the seed.
Bulbul reads with one of Sarvam's own Bulbul v3 voices (not a clone); SARVAM_API_KEYS may list several keys, comma
separated, from separately funded accounts: the next one is used only when the current account is out of credit.
  python clone.py qwen|chatterbox|eleven|sarvam|bulbul [--tries 4] [p05 p07 ...]
Writes narrator-<engine>/pNN.wav, timing.json (duration of each passage) and takes.json."""
import argparse, difflib, hashlib, json, os, pathlib, re, subprocess, tempfile, urllib.error, urllib.request, uuid, warnings
import numpy as np, soundfile as sf

warnings.filterwarnings('ignore')
here = pathlib.Path(__file__).parent
STT = 'mlx-community/whisper-small-mlx'
ENGINES = {
    'qwen': {'repo': 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit', 'spell': {'BhuAayam': 'Bhoo-aah-yaam'},
             'args': {'temperature': 0.8, 'lang_code': 'english'}},
    # Chatterbox reads quickly and says "AI" as one letter unless it is dotted; `tag` versions its cached takes
    'chatterbox': {'repo': 'mlx-community/chatterbox-fp16', 'spell': {'BhuAayam': 'Bhoo-ah-yahm', 'AI ': 'A.I. '},
                   'args': {'exaggeration': 0.45, 'cfg_weight': 0.5, 'temperature': 0.8, 'speed': 0.9}, 'tag': 'v2'},
    # remote: the model is the newest ElevenLabs text-to-speech model the account can use (see eleven_model)
    'eleven': {'remote': True, 'spell': {'BhuAayam': 'Bhoo-aah-yum'}, 'args': {'stability': 0.5, 'similarity_boost': 0.85}},
}
# Sarvam reads slowly at its natural pace and spells out capitals, so it gets a faster pace and plain spellings
ENGINES['sarvam'] = {'remote': True, 'spell': {'BhuAayam': 'Bhoo-aayam', 'ULPIN': 'Ulpin', 'LiDAR': 'lie-dar'},
                     'args': {'pace': 1.35, 'enable_qc': 'true'}, 'tag': 'pace1.35'}
# Bulbul says the brand most reliably from Devanagari, and reads quickly at its own pace 1.0
ENGINES['bulbul'] = {'remote': True, 'spell': {**ENGINES['sarvam']['spell'], 'BhuAayam': 'भूआयाम'},
                     'args': {'model': 'bulbul:v3', 'speaker': 'shubh', 'pace': 0.85}, 'tag': 'shubh0.85-dev'}
SV = 'https://api.sarvam.ai'
EL = 'https://api.elevenlabs.io'
EL_KEY = pathlib.Path.home() / '.config/elevenlabs/key'
EL_SR = 24000
REF = pathlib.Path(os.environ.get('VOICE_REF', pathlib.Path.home() / '.cache/bhuaayam-vo/voice/ref.wav'))
REF_TEXT = ('Take one flat. The deed says eighty-four square metres, the plan says eighty-one, and the drone survey finds an extra '
            'floor. Today, an officer sorts all of that out by hand. So we built BhuAayam. Every floor and every flat gets its '
            'own 3D ULPIN, and a record that anyone can check.')
LEVEL = -21.5  # LUFS for all passages together; score.js mixes the voice against this level
PACE = (1.5, 3.2)  # words per second a take may run at (the brand name alone takes a while)
lines = json.loads((here / 'lines.json').read_text())
HEARD_AS = {'meters': 'metres', '84': 'eightyfour', '81': 'eightyone', '3d': 'threed'}
NAMES = {'bhuaayam', 'ulpin'}  # spelled for pronunciation; Whisper spells them its own way


CONTRACTIONS = {"it'll": 'it will', "they're": 'they are', "there's": 'there is', "it's": 'it is', "that's": 'that is',
                "aren't": 'are not', "isn't": 'is not', "don't": 'do not', "you're": 'you are', "we're": 'we are'}


def words(text):
    text = text.lower().replace('’', "'").replace('three-d', 'threed').replace('eighty-four', 'eightyfour').replace('eighty-one', 'eightyone')
    for k, v in CONTRACTIONS.items(): text = re.sub(rf"\b{re.escape(k)}\b", v, text)
    return [w for w in (norm(x) for x in text.replace('-', ' ').split()) if w]


def norm(w):
    w = w.lower().replace('three-d', 'threed').replace('eighty-four', 'eightyfour').replace('eighty-one', 'eightyone')
    w = re.sub(r'[^a-z0-9]', '', w)
    return HEARD_AS.get(w, w)


def ok(say, heard):
    """Whisper heard the passage's words, every word of four letters or more among them, and it starts and ends on
    its own first and last words."""
    want = [w for w in words(say) if w not in NAMES]
    got = words(heard)
    if not got: return False, 0.0
    r = difflib.SequenceMatcher(None, want, got, autojunk=False).ratio()
    close = lambda x, y: difflib.SequenceMatcher(None, x, y).ratio() >= 0.7
    first = want[0] in got[:3] or close(want[0], got[0]); last = close(want[-1], got[-1]) or want[-1] in got[-2:]
    missing = [w for w in want if len(w) >= 4 and not any(difflib.SequenceMatcher(None, w, g).ratio() >= 0.8 for g in got)]
    # the names themselves: the brand heard as one word starting "bh", ULPIN as a word close to it (not "open")
    named = ('BhuAayam' not in say or any(g.startswith('bh') for g in got)) and \
            ('ULPIN' not in say or any(difflib.SequenceMatcher(None, 'ulpin', g).ratio() >= 0.75 for g in got))
    return r >= 0.85 and first and last and not missing and named, r


def trim(a, sr):
    env = np.convolve(np.abs(a), np.ones(int(sr * 0.02)) / (sr * 0.02), 'same'); on = np.where(env > max(env.max() * 0.03, 0.003))[0]
    if not len(on): return a
    i, j = max(0, on[0] - int(0.03 * sr)), min(len(a), on[-1] + int(0.15 * sr))
    b = a[i:j].astype(np.float32).copy(); f = int(0.01 * sr); b[:f] *= np.linspace(0, 1, f); b[-f * 4:] *= np.linspace(1, 0, f * 4)
    return b


def slow(a, sr, k):
    """Play a take at k (< 1) of its speed without changing pitch (ffmpeg atempo)."""
    with tempfile.TemporaryDirectory() as d:
        sf.write(f'{d}/a.wav', a, sr)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f'{d}/a.wav', '-af', f'atempo={k:.4f}', f'{d}/b.wav'], check=True)
        return sf.read(f'{d}/b.wav', dtype='float32')[0]


def multipart(fields, files=()):
    b = uuid.uuid4().hex; out = b''
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, name, data in files:
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + data + b'\r\n'
    return out + f'--{b}--\r\n'.encode(), f'multipart/form-data; boundary={b}'


SV_KEYS = [k for k in os.environ.get('SARVAM_API_KEYS', os.environ.get('SARVAM_API_KEY', '')).split(',') if k]


def sv(path, fields=None, files=(), body_json=None):
    """One Sarvam API call; returns parsed JSON. Out of credit (402) moves on to the next key's account; a rate limit
    (429) or server error waits and retries on the same key."""
    import time
    body, ctype = (json.dumps(body_json).encode(), 'application/json') if body_json is not None else multipart(fields, files)
    for attempt in range(6):
        req = urllib.request.Request(SV + path, data=body, headers={'api-subscription-key': SV_KEYS[0], 'Content-Type': ctype})
        try:
            with urllib.request.urlopen(req, timeout=180) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')[:400]
            if e.code == 402 and len(SV_KEYS) > 1:
                SV_KEYS.pop(0); print(f'  Sarvam account out of credit, moving to the next key ({len(SV_KEYS)} left)', flush=True)
            elif e.code in (429, 500, 502, 503, 504): time.sleep(2 ** attempt)
            else: raise SystemExit(f'Sarvam {path}: {e.code} {msg}')
    raise SystemExit(f'Sarvam {path}: gave up after retries')


def bulbul_say(text, args):
    import base64, io
    r = sv('/text-to-speech', body_json={'text': text, 'target_language_code': 'en-IN', 'speech_sample_rate': EL_SR, **args})
    a, sr = sf.read(io.BytesIO(base64.b64decode(r['audios'][0])), dtype='float32')
    return a if a.ndim == 1 else a.mean(1)


def sarvam_voice(rh):
    memo = pathlib.Path.home() / '.cache/bhuaayam-vo/sarvam-voice.json'
    known = json.loads(memo.read_text()) if memo.exists() else {}
    if rh in known: return known[rh]
    r = sv('/voices/create', {'name': 'BhuAayam narrator', 'language': 'en-IN'}, [('file', 'ref.wav', REF.read_bytes())])
    known[rh] = (r.get('data') or r)['voice_id']; memo.write_text(json.dumps(known, indent=1))
    return known[rh]


def sarvam_say(text, voice, args):
    import base64, io
    r = sv('/voices/clone', {'voice_id': voice, 'text': text, 'language_code': 'en-IN', 'speech_sample_rate': EL_SR, 'output_audio_codec': 'wav', **args})
    a, sr = sf.read(io.BytesIO(base64.b64decode(r['audio'])), dtype='float32')
    return a if a.ndim == 1 else a.mean(1)


def el(path, body=None, ctype='application/json'):
    """One ElevenLabs API call with the account holder's key; returns parsed JSON, or raw bytes for audio."""
    key = EL_KEY.read_text().strip()
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(EL + path, data=data, headers={'xi-api-key': key, **({'Content-Type': ctype} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read()
            return json.loads(raw) if r.headers.get_content_type() == 'application/json' else raw
    except urllib.error.HTTPError as e:
        raise SystemExit(f'ElevenLabs {path.split("?")[0]}: {e.code} {e.read().decode(errors="replace")[:400]}')


def eleven_model():
    """The newest text-to-speech model on the account: v4 when it is offered, else v3, else multilingual v2."""
    ids = [m['model_id'] for m in el('/v1/models') if m.get('can_do_text_to_speech')]
    for want in ('eleven_v4', 'v4', 'eleven_v3', 'eleven_multilingual_v2'):
        hit = [i for i in ids if want in i and 'flash' not in i and 'turbo' not in i]
        if hit: return sorted(hit)[-1]
    raise SystemExit(f'no ElevenLabs text-to-speech model found among {ids}')


def eleven_voice(rh):
    """The founder's instant voice clone, uploaded once per reference recording."""
    memo = pathlib.Path.home() / '.cache/bhuaayam-vo/eleven-voice.json'
    known = json.loads(memo.read_text()) if memo.exists() else {}
    if rh in known: return known[rh]
    b = uuid.uuid4().hex; nl = b'\r\n'
    part = lambda head, val: b'--' + b.encode() + nl + head.encode() + nl + nl + val + nl
    body = (part('Content-Disposition: form-data; name="name"', b'BhuAayam narrator')
            + part('Content-Disposition: form-data; name="description"', b'Founder narration for the BhuAayam reel')
            + part('Content-Disposition: form-data; name="files"; filename="ref.wav"\r\nContent-Type: audio/wav', REF.read_bytes())
            + b'--' + b.encode() + b'--' + nl)
    vid = el('/v1/voices/add', body, f'multipart/form-data; boundary={b}')['voice_id']
    known[rh] = vid; memo.write_text(json.dumps(known, indent=1))
    return vid


def eleven_say(text, voice, model, seed, settings):
    raw = el(f'/v1/text-to-speech/{voice}?output_format=pcm_{EL_SR}',
             {'text': text, 'model_id': model, 'seed': seed, 'voice_settings': settings})
    return np.frombuffer(raw, '<i2').astype(np.float32) / 32768


def loudness(a, sr):
    with tempfile.TemporaryDirectory() as d:
        sf.write(f'{d}/a.wav', a, sr)
        r = subprocess.run(['ffmpeg', '-hide_banner', '-i', f'{d}/a.wav', '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('engine', choices=list(ENGINES)); ap.add_argument('only', nargs='*'); ap.add_argument('--tries', type=int, default=4)
    args = ap.parse_args()
    import mlx.core as mx, mlx_whisper
    from mlx_audio.tts.utils import load_model
    stt = lambda f: mlx_whisper.transcribe(str(f), path_or_hf_repo=STT, language='en')['text'].strip()
    eng = ENGINES[args.engine]; out = here / f'narrator-{args.engine}'
    def spell(t):
        for k, v in eng['spell'].items(): t = t.replace(k, v)
        return t
    model = None
    rh = hashlib.sha256(REF.read_bytes()).hexdigest()[:12]
    if args.engine == 'bulbul':
        if not SV_KEYS: raise SystemExit('set SARVAM_API_KEYS first')
        TTS = 'sarvam-' + eng['args']['model']
    elif args.engine == 'sarvam':
        if not SV_KEYS: raise SystemExit('set SARVAM_API_KEY first')
        TTS = 'sarvam-voice-clone-en-IN'; voice = sarvam_voice(rh); print(f'Sarvam voice {voice}', flush=True)
    elif eng.get('remote'):
        if not EL_KEY.exists(): raise SystemExit(f'save the ElevenLabs API key to {EL_KEY} first')
        TTS = eleven_model(); voice = eleven_voice(rh); print(f'ElevenLabs model {TTS}, voice {voice}', flush=True)
    else: TTS = eng['repo']
    cache = pathlib.Path.home() / '.cache/bhuaayam-vo/clone'; cache.mkdir(parents=True, exist_ok=True); out.mkdir(exist_ok=True)
    report = json.loads((out / 'takes.json').read_text()) if (out / 'takes.json').exists() else {}
    report = {k: v for k, v in report.items() if k.startswith('p')}
    for l in lines:
        if args.only and l['id'] not in args.only: continue
        best = None
        for seed in range(1, args.tries + 1):
            key = hashlib.sha256(f"{TTS}|{rh}|{l['say']}|{seed}{'|' + eng['tag'] if 'tag' in eng else ''}".encode()).hexdigest()[:16]
            f = cache / f"{args.engine}-{l['id']}-{seed}-{key}.wav"
            if not f.exists() and args.engine == 'bulbul':
                sf.write(f, trim(bulbul_say(spell(l['say']), eng['args']), EL_SR), EL_SR)
            elif not f.exists() and args.engine == 'sarvam':
                sf.write(f, trim(sarvam_say(spell(l['say']), voice, eng['args']), EL_SR), EL_SR)
            elif not f.exists() and eng.get('remote'):
                sf.write(f, trim(eleven_say(spell(l['say']), voice, TTS, seed, eng['args']), EL_SR), EL_SR)
            elif not f.exists():
                if model is None: model = load_model(TTS)
                mx.random.seed(seed)
                a = np.concatenate([np.array(r.audio) for r in model.generate(text=spell(l['say']), ref_audio=str(REF), ref_text=REF_TEXT, **eng['args'])])
                sf.write(f, trim(a, model.sample_rate), model.sample_rate)
            a, sr = sf.read(f, dtype='float32'); heard = stt(f); good, r = ok(l['say'], heard)
            pace = len(l['say'].split()) / (len(a) / sr); calm = PACE[0] <= pace <= PACE[1]
            print(f"{l['id']} take {seed}: {len(a) / sr:.1f} s, {pace:.2f} w/s, words {r:.2f}{'' if good else ' OFF'}{'' if calm else ' PACE'} | {heard}", flush=True)
            score = (not good, not calm, -r)
            if best is None or score < best[0]: best = (score, seed, f, heard)
            if good and calm: break
        report[l['id']] = {'take': best[1], 'heard': best[3], 'passes': not any(best[0][:2])}
        (cache / f"{args.engine}-{l['id']}-best.txt").write_text(str(best[2]))
    (out / 'takes.json').write_text(json.dumps(report, indent=1))
    missing = [l['id'] for l in lines if not (cache / f"{args.engine}-{l['id']}-best.txt").exists()]
    if missing: print('not levelled yet, still to record:', ' '.join(missing)); return
    # one gain for the whole narration
    parts = {l['id']: sf.read(pathlib.Path((cache / f"{args.engine}-{l['id']}-best.txt").read_text()), dtype='float32') for l in lines}
    sr = next(iter(parts.values()))[1]
    # a take that passed every word but still reads too fast is slowed to the top of the natural range
    for l in lines:
        a = parts[l['id']][0]; pace = len(l['say'].split()) / (len(a) / sr)
        if pace > PACE[1]: parts[l['id']] = (slow(a, sr, max(0.85, PACE[1] / pace)), sr); print(f"{l['id']}: slowed from {pace:.2f} w/s")
    allv = np.concatenate([p for p, _ in parts.values()])
    g = min(10 ** ((LEVEL - loudness(allv, sr)) / 20), 10 ** (-1 / 20) / np.abs(allv).max())
    timing = {}
    for k, (p, _) in parts.items():
        sf.write(out / f'{k}.wav', p * g, sr, subtype='PCM_16'); timing[k] = {'dur': round(len(p) / sr, 3)}
    (out / 'timing.json').write_text(json.dumps(timing, indent=1))
    (out / 'takes.json').write_text(json.dumps({'model': TTS, 'gain_db': round(float(20 * np.log10(g)), 2), **report}, indent=1))
    print(f'level: gain {20 * np.log10(g):+.1f} dB', flush=True)


if __name__ == '__main__':
    main()
