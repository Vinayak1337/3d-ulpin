import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: [
    '@nestjs/*', '@aws-sdk/client-s3', 'dotenv', 'earcut', 'express',
    'fflate', 'geotiff', 'papaparse', 'pdfjs-dist/*', 'pg',
    'playwright', 'reflect-metadata', 'rxjs', 'zod',
  ],
});
