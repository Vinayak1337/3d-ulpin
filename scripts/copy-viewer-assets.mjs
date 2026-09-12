import { createRequire } from "node:module";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const cesium = path.dirname(require.resolve("cesium/package.json"));
const pdfjs = path.dirname(require.resolve("pdfjs-dist/package.json"));
const destination = path.join(root, "apps/web/public");
await mkdir(path.join(destination, "cesium"), { recursive: true });
for (const folder of ["Assets", "Workers", "ThirdParty", "Widgets"]) {
  await cp(
    path.join(cesium, "Build/Cesium", folder),
    path.join(destination, "cesium", folder),
    { recursive: true },
  );
}
await cp(
  path.join(pdfjs, "build/pdf.worker.min.mjs"),
  path.join(destination, "pdf.worker.min.mjs"),
);
