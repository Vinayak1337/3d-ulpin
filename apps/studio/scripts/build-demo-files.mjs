#!/usr/bin/env node
/**
 * Writes the files an officer drops into the Studio for the Lake View walkthrough, from the same records
 * the local data layer serves: the area survey (GeoJSON in EPSG:32643) and the residence's documents
 * (level schedule, unit inventory, plan and deeds as PDF). Run: node apps/studio/scripts/build-demo-files.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../src/local/data/lake-view');
const out = join(here, '../demo-files');
mkdirSync(join(out, '1-area'), { recursive: true });
mkdirSync(join(out, '2-building'), { recursive: true });
const read = (f) => JSON.parse(readFileSync(join(data, f), 'utf8'));
const context = read('context.json');
const register = read('register.json');
const files = read('files.json');
const documents = read('documents.json');
const [E0, N0] = context.area.reference.origin;

// 1. Area survey: every feature, easting/northing in EPSG:32643.
const project = (ring) => ring.map(([x, y]) => [Math.round((E0 + x) * 1000) / 1000, Math.round((N0 + y) * 1000) / 1000]);
const survey = {
  type: 'FeatureCollection', name: 'lake_view_survey',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32643' } },
  features: context.features.map((f, i) => ({
    type: 'Feature',
    properties: {
      fid: i + 1, name: f.name, kind: f.kind, ...(f.kind === 'parcel' ? { ulpin: f.properties?.ulpin ?? f.identifier } : {}),
      height_m: f.height?.value ?? null, floors: f.semantics?.floorCount ?? null,
      ...(f.properties?.land_cover ? { land_cover: f.properties.land_cover } : {}),
      ...(f.verticalExtent ? { depth_top_m: f.verticalExtent.upper, depth_bottom_m: f.verticalExtent.lower } : {}),
    },
    geometry: { type: 'Polygon', coordinates: f.geometry.coordinates.map(project) },
  })),
};
writeFileSync(join(out, '1-area/lake_view_survey.geojson'), JSON.stringify(survey));

// 2. Building documents.
const byName = Object.fromEntries(register.sources.map((s) => [s.name, s.id]));
writeFileSync(join(out, '2-building/levels.csv'), files[byName['levels.csv']].body);
writeFileSync(join(out, '2-building/unit_inventory.csv'), files[byName['unit_inventory.xlsx']].body);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of ['plan_F7.pdf', 'deed_of_declaration.pdf', 'sale_deed_704.pdf']) {
  const doc = documents[byName[name]];
  const html = `<html><head><style>@page{size:842px 595px;margin:0}body{margin:0}svg{display:block;page-break-after:always}</style></head><body>${doc.pages.map((p) => p.svg).join('')}</body></html>`;
  await page.setContent(html);
  await page.pdf({ path: join(out, '2-building', name), width: '842px', height: '595px', printBackground: true });
}
await browser.close();
console.log(`Demo files → ${out}`);
