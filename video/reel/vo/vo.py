"""Voice-over for the reel: Qwen3-TTS 1.7B VoiceDesign (Apache-2.0) on Apple Silicon through mlx-audio.

Each narrator reads the whole script in one pass, so the voice and the prosody stay continuous from line to line.
Several takes are recorded per narrator, and each take is transcribed with Whisper word timings. The take that
reads every word and best fits the picture is kept, then cut into lines at the pauses between sentences.
Before the montage the picture keeps its original pace, so each line is placed near its headline: it may start up
to EARLY before or LATE after its authored time, and a line that still runs long is tightened with atempo (at most
MAX_TEMPO). From the montage on, the picture holds for the line (warp.js), so those lines start on their cue.

Setup (outside the repo): a Python 3.11 venv with mlx-audio, mlx-whisper and soundfile, plus ffmpeg on PATH.
The models download from Hugging Face on first use:
  mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit, mlx-community/whisper-small-mlx
  python vo.py [male|female ...] [--takes 4]
Takes are cached in ~/.cache/bhuaayam-vo, keyed by the script and the voice description.
Writes <voice>/vNN.wav (24 kHz mono), <voice>/timing.json (start on the authored clock, duration) and
<voice>/take.json next to this file."""
import argparse, difflib, hashlib, json, pathlib, re, subprocess, tempfile, warnings
import numpy as np, soundfile as sf

warnings.filterwarnings('ignore')
here = pathlib.Path(__file__).parent
TTS = 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit'
STT = 'mlx-community/whisper-small-mlx'
SR = 24000
HOLD_FROM = 84  # warp.js: from the montage on, the picture waits for the line
MAX_TEMPO = 1.1
EARLY, LATE, GAP = 0.25, 0.45, 0.15
LEVEL = -21.5  # LUFS for each narrator's lines together; score.js mixes the voice against this level
VOICES = {
    'male': 'A deep, warm male narrator in his early forties, American English. Confident and grounded, with an engaged, '
            'forward-moving delivery at a brisk pace for a product launch film: clear, natural and human, with short natural pauses '
            'between sentences. Not an announcer, not salesy.',
    'female': 'A warm, grounded female narrator in her late thirties, American English. Low-mid pitch, confident and clear, '
              'with an engaged, forward-moving delivery for a product launch film and short natural pauses between '
              'sentences. Natural and human, not salesy.',
}

lines = json.loads((here / 'lines.json').read_text())


def norm(w):
    w = w.lower().replace('three-d', '3d')
    return re.sub(r'[^a-z0-9]', '', w)


def tokens():
    out = []
    for li, l in enumerate(lines):
        for w in l['say'].split():
            n = norm(w)
            if n: out.append((li, n))
    return out


def rms(a, hop=240, win=480):
    pad = np.pad(a, (win // 2, win // 2))
    return np.array([np.sqrt(np.mean(pad[i:i + win] ** 2)) for i in range(0, len(a), hop)]), hop


def align(words):
    """Map each script line to [start, end] seconds in the take, and report word coverage."""
    script = tokens(); heard = [norm(w['word']) for w in words]
    sm = difflib.SequenceMatcher(None, [n for _, n in script], heard, autojunk=False)
    hit = {}
    for b in sm.get_matching_blocks():
        for k in range(b.size): hit[b.a + k] = b.b + k
    spans = []
    for li in range(len(lines)):
        idx = [hit[k] for k, (lj, _) in enumerate(script) if lj == li and k in hit]
        spans.append((words[min(idx)]['start'], words[max(idx)]['end']) if idx else None)
    # a line nothing matched (the brand name) sits between its neighbours
    guessed = [s is None for s in spans]
    for i, s in enumerate(spans):
        if s is None:
            prev = next((spans[j][1] for j in range(i - 1, -1, -1) if spans[j]), 0.0)
            nxt = next((spans[j][0] for j in range(i + 1, len(spans)) if spans[j]), None)
            spans[i] = (prev + 0.05, (nxt - 0.05) if nxt else prev + 1.2)
    return spans, guessed, len(hit) / len(script)


def cut(a, spans, guessed):
    """Cut between lines in a pause. Word timings can be early or late by a syllable, so the cut goes in the
    pause nearest the expected boundary: after the line before a guessed span, before the line after it."""
    env, hop = rms(a); fps = SR / hop
    quiet = env < max(env.max() * 0.02, 0.003)
    pauses, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]: j += 1
            if (j - i) / fps >= 0.08: pauses.append((i / fps, j / fps))
            i = j
        else: i += 1
    cuts = [0]
    for k, ((s0, e0), (s1, e1)) in enumerate(zip(spans, spans[1:])):
        want = e0 if guessed[k + 1] else s1 if guessed[k] else (e0 + s1) / 2
        lo, hi = min(e0, s1) - 0.35, max(e0, s1) + 0.35
        floor = cuts[-1] / SR + 0.2
        near = [p for p in pauses if p[1] > max(lo, floor) and p[0] < hi]
        if near:
            p = min(near, key=lambda p: abs((p[0] + p[1]) / 2 - want) if not (p[0] <= want <= p[1]) else 0)
            cuts.append(int((p[0] + p[1]) / 2 * SR))
        else:
            f0, f1 = max(int(floor * fps), int(lo * fps)), min(len(env) - 1, max(int(hi * fps), int(floor * fps) + 2))
            cuts.append((f0 + int(np.argmin(env[f0:f1 + 1]))) * hop)
    for i in range(1, len(cuts)): cuts[i] = min(len(a) - (len(cuts) - i) * hop, max(cuts[i], cuts[i - 1] + hop * 8))
    cuts.append(len(a))
    return cuts, [int((p0 + p1) / 2 * SR) for p0, p1 in pauses]


def segs(a, cuts):
    return [trim(a[cuts[i]:cuts[i + 1]]) for i in range(len(cuts) - 1)]


def trim(a, pre=0.03, post=0.12):
    env, hop = rms(a); on = np.where(env > max(env.max() * 0.03, 0.004))[0]
    if not len(on): return a
    i, j = max(0, on[0] * hop - int(pre * SR)), min(len(a), on[-1] * hop + int(post * SR))
    out = a[i:j].astype(np.float32).copy(); f = int(0.01 * SR)
    out[:f] *= np.linspace(0, 1, f); out[-f * 4:] *= np.linspace(1, 0, f * 4)
    return out


# how Whisper spells words the narrator said correctly
HEARD_AS = {'bite': 'byte', 'sites': 'cites', 'normalizes': 'normalises', 'to': 'too', 'ulpen': 'ulpin'}


def line_ok(l, t):
    """A cut line reads right: the same words, and it starts and ends on its own first and last word, so nothing
    was clipped or spilled over from a neighbour."""
    got = [g for g in (norm(w) for w in t.replace('-', ' ').split()) if g]
    if 'bhoo' in l['say'].lower(): return 1 <= len(got) <= 3  # the brand name has no English spelling
    got = [HEARD_AS.get(g, g) for g in got]; want = [norm(w) for w in l['say'].split()]
    if not got or len(got) > len(want) + 2: return False
    close = lambda x, y: difflib.SequenceMatcher(None, x, y).ratio() >= 0.7
    first = close(want[0], got[0]) or (len(got) > 1 and close(want[0], got[0] + got[1]))
    last = close(want[-1], got[-1]) or (len(got) > 1 and close(want[-1], got[-2] + got[-1]))
    return first and last and difflib.SequenceMatcher(None, want, got, autojunk=False).ratio() >= 0.75


def check(parts, stt, only=None):
    """Transcribe each cut line on its own; a clipped or spilled word shows up as a line that reads wrong."""
    heard = {}
    with tempfile.TemporaryDirectory() as d:
        for i, (l, p) in enumerate(zip(lines, parts)):
            if only is not None and i not in only: continue
            sf.write(f'{d}/l.wav', p, SR); heard[i] = stt(f'{d}/l.wav')
    return [i for i, t in heard.items() if not line_ok(lines[i], t)], heard


def repair(a, cuts, pauses, stt, reach=1.2):
    """Move the cuts around a line that reads wrong to other pauses nearby until it and its neighbours read right."""
    bad, heard = check(segs(a, cuts), stt)
    for i in list(bad):
        if i not in bad: continue
        opts = lambda c, lo, hi: sorted({c, *[p for p in pauses if abs(p - c) < reach * SR and lo < p < hi]}, key=lambda p: abs(p - c))
        best = None
        for L in (opts(cuts[i], cuts[i - 1] if i else -1, cuts[i + 1]) if 0 < i else [0]):
            for R in (opts(cuts[i + 1], L, cuts[i + 2] if i + 2 < len(cuts) else len(a) + 1) if i + 1 < len(cuts) - 1 else [len(a)]):
                trial = cuts[:i] + [L, R] + cuts[i + 2:]
                near = [j for j in (i - 1, i, i + 1) if 0 <= j < len(lines)]
                b, h = check(segs(a, trial), stt, only=set(near))
                if not b: best = (trial, h); break
            if best: break
        if best:
            cuts = best[0]; heard.update(best[1]); bad = [j for j in bad if j not in (i - 1, i, i + 1)]
    return cuts, [j for j in bad], [heard[j] for j in range(len(lines))]


def loudness(parts):
    """Integrated loudness (LUFS) of the lines played back to back, measured by ffmpeg's EBU R128 meter."""
    with tempfile.TemporaryDirectory() as d:
        sf.write(f'{d}/all.wav', np.concatenate(parts), SR)
        r = subprocess.run(['ffmpeg', '-hide_banner', '-i', f'{d}/all.wav', '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1])


def tempo(a, k):
    with tempfile.TemporaryDirectory() as d:
        src, dst = f'{d}/a.wav', f'{d}/b.wav'; sf.write(src, a, SR)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-af', f'atempo={k:.4f}', dst], check=True)
        return sf.read(dst, dtype='float32')[0]


def place(parts):
    """Start and tempo for each line. Before the montage a line starts on its cue, or later if the line before it
    is still speaking, or earlier if it would otherwise run into the next line; what remains is tightened.
    Returns the plan, the time still overlapping, the total tightening and the total lateness."""
    plan, end, over, squeeze, late = [], -1.0, 0.0, 0.0, 0.0
    for i, (l, p) in enumerate(zip(lines, parts)):
        d = len(p) / SR
        if l['a'] >= HOLD_FROM: plan.append((l['a'], 1.0)); end = l['a'] + d; continue
        nxt = lines[i + 1]['a'] + (LATE if lines[i + 1]['a'] < HOLD_FROM else 0) - GAP
        start = max(l['a'], end + GAP)
        if start + d > nxt: start = max(l['a'] - EARLY, end + GAP)
        k = 1.0
        if start + d > nxt: k = min(MAX_TEMPO, d / max(0.1, nxt - start)); squeeze += k - 1
        over += max(0.0, start + d / k - nxt); late += max(0.0, start - l['a'])
        plan.append((round(start, 3), k)); end = start + d / k
    return plan, over, squeeze, late


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('voices', nargs='*', default=list(VOICES)); ap.add_argument('--takes', type=int, default=4)
    args = ap.parse_args()
    import mlx.core as mx, mlx_whisper
    from mlx_audio.tts.utils import load_model
    model = load_model(TTS)
    stt = lambda f: mlx_whisper.transcribe(f, path_or_hf_repo=STT, language='en')['text'].strip()
    text = ' '.join(l['say'] for l in lines)
    for v in args.voices:
        out = here / v; out.mkdir(exist_ok=True); best = None
        for seed in range(1, args.takes + 1):
            key = hashlib.sha256(f'{TTS}|{VOICES[v]}|{text}|{seed}'.encode()).hexdigest()[:16]
            cache = pathlib.Path.home() / '.cache/bhuaayam-vo' / f'{v}-{seed}-{key}'
            if (cache / 'take.wav').exists():
                a = sf.read(cache / 'take.wav', dtype='float32')[0]; res = json.loads((cache / 'words.json').read_text())
            else:
                mx.random.seed(seed)
                a = np.concatenate([np.array(r.audio) for r in model.generate(text=text, instruct=VOICES[v], lang_code='english', temperature=0.8)]).astype(np.float32)
                cache.mkdir(parents=True, exist_ok=True); sf.write(cache / 'take.wav', a, SR)
                res = mlx_whisper.transcribe(str(cache / 'take.wav'), path_or_hf_repo=STT, language='en', word_timestamps=True)
                (cache / 'words.json').write_text(json.dumps({'text': res['text'], 'segments': [{'words': s.get('words', [])} for s in res['segments']]}))
            words = [w for s in res['segments'] for w in s.get('words', [])]
            spans, guessed, cov = align(words); cuts, pauses = cut(a, spans, guessed)
            cuts, bad, heard = repair(a, cuts, pauses, stt); parts = segs(a, cuts); plan, over, squeeze, late = place(parts)
            bad = [lines[j]['id'] for j in bad]
            print(f'{v} take {seed}: {len(a) / SR:.1f} s, words {cov:.0%}, lines off {bad or "none"}, overlap {over:.2f} s, squeeze {squeeze:.2f}, late {late:.2f} s', flush=True)
            key = (len(bad), cov < 0.93, round(over, 1), round(squeeze + late / 4, 2))
            if best is None or key < best[0]: best = (key, seed, parts, plan, heard, cov)
        _, seed, parts, plan, heard, cov = best
        timing = {}
        parts = [tempo(p, k) if k > 1.0005 else p for p, (_, k) in zip(parts, plan)]
        g = 10 ** ((LEVEL - loudness(parts)) / 20); peak = max(np.abs(p).max() for p in parts)
        g = min(g, 10 ** (-1 / 20) / peak)  # keep peaks under -1 dBFS
        parts = [p * g for p in parts]
        print(f'  level: gain {20 * np.log10(g):+.1f} dB, now {loudness(parts):.1f} LUFS')
        for l, p, (start, k) in zip(lines, parts, plan):
            sf.write(out / f"{l['id']}.wav", p, SR, subtype='PCM_16')
            timing[l['id']] = {'start': start, 'dur': round(len(p) / SR, 3)}
            print(f"  {l['id']} {start:6.2f} ({start - l['a']:+.2f}) {timing[l['id']]['dur']:5.2f}{f' x{k:.2f}' if k > 1.0005 else ''}  {l['say']}")
        (out / 'timing.json').write_text(json.dumps(timing, indent=1))
        for l, t in zip(lines, heard): print(f"  heard {l['id']}: {t}")
        (out / 'take.json').write_text(json.dumps({'model': TTS, 'seed': seed, 'temperature': 0.8, 'instruct': VOICES[v], 'words_heard': round(cov, 3), 'lines_heard': dict(zip([l['id'] for l in lines], heard))}, indent=1))
        print(f'{v}: kept take {seed}', flush=True)


if __name__ == '__main__':
    main()
