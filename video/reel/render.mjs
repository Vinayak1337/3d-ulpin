// Renders the reel frame by frame (deterministic) and encodes it with ffmpeg. SCALE=2 renders 3840 × 2160.
// VOICE picks the narration folder under vo/ (narrator-qwen, narrator-chatterbox or narrator-bulbul); the picture's timing follows it.
//   node video/reel/render.mjs stills 1,20,45 out/        → PNG stills at those seconds
//   node video/reel/render.mjs video out/launch.mp4 [fps] [workers] [from] [to]
// Serve the worktree root first: python3 -m http.server 8790 --bind 127.0.0.1
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const SCALE = +(process.env.SCALE ?? 1);
const URL_ = process.env.REEL_URL ?? `http://127.0.0.1:8790/video/reel/index.html?render&scale=${SCALE}&fps=${process.env.FPS ?? 30}&voice=${process.env.VOICE ?? 'narrator-qwen'}`;
const [mode, arg, ...rest] = process.argv.slice(2);
const out = rest[0]; // stills: directory · mux: audio file
const GPU = process.env.GPU !== '0';
const args = GPU ? [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => console.error('PAGE', e.message));
  await page.goto(URL_, { timeout: 120000 });
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  return page;
}

const browser = await chromium.launch({ args });
if (mode === 'stills') {
  const page = await open(browser);
  const dir = out ?? '.'; mkdirSync(dir, { recursive: true });
  for (const s of arg.split(',').map(Number)) {
    await page.evaluate((t) => window.seek(t), s);
    await page.screenshot({ path: join(dir, `t${String(s.toFixed(1)).padStart(6, '0')}.png`) });
  }
} else if (mode === 'audio') {
  const page = await open(browser);
  const b64 = await page.evaluate(() => window.renderAudio());
  writeFileSync(arg, Buffer.from(b64, 'base64')); console.log('wrote', arg);
} else if (mode === 'mux') {
  // node render.mjs mux video.mp4 audio.wav out.mp4
  await new Promise((r) => spawn('ffmpeg', ['-loglevel', 'error', '-y', '-i', arg, '-i', out, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', rest[1]], { stdio: 'inherit' }).on('close', r));
  console.log('muxed', rest[1]);
} else if (mode === 'video') {
  const [fpsArg, workersArg, fromArg, toArg] = rest; const fps = +(fpsArg ?? 30), W = +(workersArg ?? 4);
  const first = await open(browser); const dur = await first.evaluate(() => window.DUR);
  const from = +(fromArg ?? 0), to = +(toArg ?? dur);
  const frames = Math.round((to - from) * fps);
  const tmp = `${arg}.parts`; mkdirSync(tmp, { recursive: true });
  const per = Math.ceil(frames / W); const t0 = Date.now();
  const pages = [first]; for (let w = 1; w < W; w++) pages.push(await open(browser));
  await Promise.all(Array.from({ length: W }, async (_, w) => {
    const a = w * per, b = Math.min(frames, a + per); if (a >= b) return;
    const page = pages[w];
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', SCALE > 1 ? '15' : '14', '-pix_fmt', 'yuv420p', join(tmp, `p${w}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = a; f < b; f++) {
      await page.evaluate((t) => window.seek(t), from + f / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (w === 0 && (f - a) % 60 === 0) console.log(`frame ${f - a}/${b - a} (worker 0) · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  }));
  const list = Array.from({ length: W }, (_, w) => `file '${join(tmp, `p${w}.mp4`)}'`).join('\n');
  writeFileSync(join(tmp, 'list.txt'), list);
  await new Promise((r) => spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-c', 'copy', arg], { stdio: 'inherit' }).on('close', r));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`done ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${arg}`);
}
await browser.close();
