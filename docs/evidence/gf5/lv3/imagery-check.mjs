import { comparePixels } from './pixels.mjs';

async function decodedPixels(page, dataset) {
  return page.evaluate(async (dataset) => {
    const response = await fetch(dataset.originalUrl);
    if (!response.ok) throw new Error(`Imagery check fetch failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const referenceBytes = bytes.slice(0); // Evidence-only control; product transfers without this copy.
    const worker = new Worker('/src/features/map/imagery.worker.ts', { type: 'module' });
    const reply = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(bytes, [bytes]);
    }).finally(() => worker.terminate());
    if ('error' in reply || !reply.rgba) throw new Error(reply.error ?? 'Raster refused');
    const { fromArrayBuffer } = await import('/node_modules/.vite/deps/geotiff.js');
    const image = await (await fromArrayBuffer(referenceBytes)).getImage();
    const raster = await image.readRasters({ interleave: true });
    const reference = new Uint8ClampedArray(image.getWidth() * image.getHeight() * 4);
    const bands = image.getSamplesPerPixel();
    for (let pixel = 0, sample = 0; pixel < reference.length / 4; pixel++, sample += bands) {
      reference[pixel * 4] = raster[sample];
      reference[pixel * 4 + 1] = raster[sample + 1];
      reference[pixel * 4 + 2] = raster[sample + 2];
      reference[pixel * 4 + 3] = bands > 3 ? raster[sample + 3] : 255;
    }
    window.__lv3Imagery = { profile: reply.profile, rgba: reply.rgba, reference };
    return {
      profile: reply.profile,
      comparedBytes: reference.length,
      differentBytes: reference.reduce((count, value, index) => count + Number(value !== reply.rgba[index]), 0),
      transferredSourceBytes: bytes.byteLength,
    };
  }, dataset);
}

async function showImage(page, root, dataset, reference, useReference) {
  await page.evaluate(async ({ root, dataset, reference, useReference }) => {
    const { utmForward, utmZone } = await import(`/@fs/${root}/apps/studio/src/features/map/overlays.ts`);
    const { profile, rgba, reference: referencePixels } = window.__lv3Imagery;
    const canvas = document.createElement('canvas');
    canvas.width = profile.width;
    canvas.height = profile.height;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(profile.width, profile.height);
    pixels.data.set(useReference ? referencePixels : rgba);
    ctx.putImageData(pixels, 0, 0);
    const zone = utmZone(reference.analysisCrs);
    const local = (lon, lat) => {
      const [x, y] = utmForward(lon, lat, zone.zone, zone.south);
      return [x - reference.origin[0], y - reference.origin[1]];
    };
    const [west, south, east, north] = dataset.bounds4326;
    window.__ulpinScene.setOverlays([{
      id: dataset.sourceId, kind: 'image', role: 'ground', image: canvas,
      corners: [local(west, south), local(east, south), local(east, north), local(west, north)],
    }]);
  }, { root, dataset, reference, useReference });
  await page.waitForTimeout(500);
}

export async function checkImagery(page, root, state, scratch, rect) {
  const dataset = state.datasets.find((entry) => entry.layer === 'imagery');
  const decoded = await decodedPixels(page, dataset);
  await showImage(page, root, dataset, state.area.reference, false);
  const workerPicture = `${scratch}/imagery-worker.png`;
  await page.screenshot({ path: workerPicture });
  await showImage(page, root, dataset, state.area.reference, true);
  const referencePicture = `${scratch}/imagery-reference.png`;
  await page.screenshot({ path: referencePicture });
  return {
    ...decoded,
    workerPicture,
    referencePicture,
    pixels: await comparePixels(referencePicture, workerPicture, rect, `${scratch}/imagery-difference.png`),
    qualification: 'Real NYC raster, explicitly on, worker versus prior synchronous raster loop at the same pose.',
  };
}
