import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const extraction = JSON.parse(readFileSync('extraction-map.json', 'utf8'));
const entries = ['src/index.ts', ...extraction.mappings.map(({ destination }) =>
  destination.replace(/^packages\/server\//, ''))];

await build({
  entryPoints: entries,
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: [
    '@aws-sdk/client-s3', 'dotenv', 'earcut', 'fflate', 'geotiff',
    'papaparse', 'pdfjs-dist/*', 'pg', 'playwright', 'zod',
  ],
});
