/**
 * Draws page 1 of a card PDF to a PNG and writes the text of the page, one printed line a row, so the rows can
 * be looked at and compared as rendered. Usage: tsx rasterise.ts <card.pdf> <card.png> <card.txt>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCALE = 2.5;
// pdfjs-dist and its canvas are dependencies of the server package, so they are resolved from there.
const require = createRequire(new URL('../../../../packages/server/package.json', import.meta.url));
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));

type TextItem = { str: string; transform: number[] };

/** Text items grouped by their baseline, top to bottom, each line left to right. */
function printedLines(items: TextItem[]) {
  const lines = new Map<number, TextItem[]>();
  for (const item of items.filter(entry => entry.str.trim())) {
    const baseline = Math.round(item.transform[5]);
    lines.set(baseline, [...lines.get(baseline) ?? [], item]);
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) =>
    line.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join('  '));
}

async function main() {
  const [pdfPath, pngPath, textPath] = process.argv.slice(2);
  const pdfjs = await import(pathToFileURL(join(pdfjsRoot, 'legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: false,
    standardFontDataUrl: `${join(pdfjsRoot, 'standard_fonts')}/` });
  const document = await task.promise;
  try {
    if (document.numPages !== 1) throw new Error(`Expected a one-page card, found ${document.numPages} pages.`);
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: SCALE });
    const { canvas, context } = document.canvasFactory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    await writeFile(pngPath, canvas.toBuffer('image/png'));
    const text = await page.getTextContent();
    await writeFile(textPath, `${printedLines(text.items as TextItem[]).join('\n')}\n`);
  } finally {
    await task.destroy();
  }
}

await main();
