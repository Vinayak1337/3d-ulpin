import { fromArrayBuffer } from 'geotiff';
import { imageryRefusal, rasterToRgba, type ImageryProfile, type ImageryReply } from './imagery-pixels';

async function decode(bytes: ArrayBuffer): Promise<void> {
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const profile: ImageryProfile = {
    width: image.getWidth(),
    height: image.getHeight(),
    bands: image.getSamplesPerPixel(),
    projectedCSTypeGeoKey: image.getGeoKeys().ProjectedCSTypeGeoKey,
  };
  // Return facts for the main thread to raise the existing refusal, without allocating refused rasters.
  if (imageryRefusal(profile)) {
    self.postMessage({ profile } satisfies ImageryReply);
    return;
  }
  const raster = await image.readRasters({ interleave: true });
  const rgba = rasterToRgba(raster as ArrayLike<number>, profile.width * profile.height, profile.bands as 3 | 4);
  self.postMessage({ profile, rgba } satisfies ImageryReply, { transfer: [rgba.buffer] });
}

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  void decode(event.data).catch((error: unknown) => {
    self.postMessage({
      error: error instanceof Error ? error.message : 'overlay could not be loaded',
    } satisfies ImageryReply);
  });
};
