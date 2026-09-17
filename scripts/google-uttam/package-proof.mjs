import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const acquisition=resolve(process.argv[2]||'../uttam-nagar-import-20260917');
const evidence=resolve(acquisition,'evidence/google-final');
const out=resolve(acquisition,'GOOGLE_UTTAM_NAGAR_SHAREABLE');
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const v=await json(resolve(evidence,'verification.json'));
const objects=await json(resolve(evidence,'original-object-preservation.json'));
const rows=await json(resolve(acquisition,'../3d-ulpin-uttam-nagar-20260917/existing-preservation-result.json'));
assert.equal(v.result,'PASS');assert.equal(objects.result,'PASS');assert.equal(rows.result,'PASS');
for(const folder of ['', 'inputs','reports','screenshots','scripts','pdf-preview'])await mkdir(resolve(out,folder),{recursive:true});
for(const name of ['Google-Uttam-Nagar-Verified-Demo.mp4','Google-Uttam-Nagar-Verified-Demo.srt','Google-UN-A-fictional-register.pdf','browser-trace.zip'])await copyFile(resolve(evidence,name),resolve(out,name));
for(const name of ['verification.json','computed-check.json','original-object-preservation.json','media.json'])await copyFile(resolve(evidence,name),resolve(out,'reports',name));
await writeFile(resolve(out,'reports','preexisting-row-preservation.json'),JSON.stringify(rows,null,2));
for(const name of ['delhi-extract-report.json','source-plan.json'])await copyFile(resolve(acquisition,name),resolve(out,'reports',name));
await copyFile(resolve(acquisition,'downloads/391_buildings.csv.gz.provenance.json'),resolve(out,'reports/google-regional-download.json'));
await copyFile(resolve(acquisition,'downloads/google-v3-score-thresholds.csv'),resolve(out,'reports/google-v3-score-thresholds.csv'));
for(const name of ['focused-tests.txt','typecheck.txt','production-build.txt'])await copyFile(resolve(acquisition,'evidence/google',name),resolve(out,'reports',name));
for(const name of await readdir(resolve(evidence,'screenshots')))if(name.endsWith('.png'))await copyFile(resolve(evidence,'screenshots',name),resolve(out,'screenshots',name));
for(const name of await readdir(resolve(evidence,'pdf-preview')))if(/\.png$|inspection\.json$/.test(name))await copyFile(resolve(evidence,'pdf-preview',name),resolve(out,'pdf-preview',name));
for(const name of await readdir(resolve(root,'fixtures/google-uttam')))await copyFile(resolve(root,'fixtures/google-uttam',name),resolve(out,'inputs',name));
for(const name of await readdir(resolve(root,'scripts/google-uttam')))if(/\.(mjs|py)$/.test(name))await copyFile(resolve(root,'scripts/google-uttam',name),resolve(out,'scripts',name));
await copyFile(resolve(root,'docs/GOOGLE_UTTAM_NAGAR.md'),resolve(out,'TECHNICAL_HANDOFF.md'));
const media=await json(resolve(evidence,'media.json'));
const selection=await json(resolve(root,'fixtures/google-uttam/selection-report.json'));
const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const summary={result:'PASS',verifiedAt:v.finishedAt,branch,baseCommit:commit,publicArea:v.real,fictionalArea:v.demo,buildings:v.buildings.map(({key,id,register,floors,spaces})=>({key,id,register,floors,spaces})),newCalculation:{measuredAreaM2:v.computedCheck.actualCrossing.areaM2,independentAreaM2:v.computedCheck.expectedCrossingM2,synthetic:true},video:{duration:media.format.duration,bytes:media.format.size},originalRowsPreserved:rows.checks.every(r=>r.missingOrChangedOriginalRows===0),originalObjectsPreserved:objects.objects,sourceFilesHashVerified:v.originalsVerified,uncaughtBrowserErrors:v.pageErrors.length,httpErrors:v.httpErrors.length,cancelledRequests:v.requestFailures.length,selection};
await writeFile(resolve(out,'reports/acceptance-summary.json'),JSON.stringify(summary,null,2));
const readme=`# Delhi / Uttam Nagar — Google dataset integration proof

**Verified:** ${v.finishedAt}. Native Windows app at http://127.0.0.1:3000. This package contains actual input files and first-hand browser evidence, not a mockup.

## Start here

Watch **Google-Uttam-Nagar-Verified-Demo.mp4** (${Number(media.format.duration).toFixed(1)} seconds; ${(Number(media.format.size)/1e6).toFixed(2)} MB). The recording has no cuts, substituted application results or voiceover. Optional same-named SRT subtitles describe the checkpoints. The browser trace and screenshots preserve the actual interactions. The property PDF was downloaded through the app, rendered and inspected.

Public reference: http://127.0.0.1:3000/blocks/${v.real.areaId}

Fictional 3D registry: http://127.0.0.1:3000/blocks/${v.demo.areaId}

Building A register: ${v.buildings.find(b=>b.key==='A').register}

## Downloaded versus imported

The official Google regional shard is 7.19 GB compressed. The Delhi-only filter retains **2,432,825 source detections in 235,760,358 compressed bytes** at:

\`E:\\Projects\\uttam-nagar-import-20260917\\data\\delhi-google-open-buildings-v3.csv.gz\`

That full archive is kept outside this small shareable package and is not loaded wholesale into the app. Its hash and source selection are in reports/delhi-extract-report.json.

The selected 1.89 ha street block has **91 detections**. All are retained in inputs/00-all-google-detections.geojson. The main app layer contains the **15** meeting the documented **0.801** regional confidence threshold, plus **35 clipped OSM road/path segments**. The other 76 detections are retained for inspection, not claimed to be false. The selected display is not a complete house inventory.

The separate fictional copy adds assumed heights, assumed 6 m road widths, and one invented crossing corridor. Three buildings contain **9 floors, 27 room/common-space records, 18 fictional individual occupants and 9 fictional shared-access groups**. None are actual resident identities or ownership records. The fake names and allocations are searchable and linked to retained source evidence.

The actual running check measured **${v.computedCheck.actualCrossing.areaM2.toFixed(3)} m²** where the invented corridor crosses building A. Independent projected-geometry computation gave **${v.computedCheck.expectedCrossingM2.toFixed(3)} m²**. This is a verified computation on synthetic test inputs, not evidence of real illegal occupation.

## Acceptance

The browser test passed ${v.chapters.length} recorded scenes, with zero uncaught page errors and zero HTTP error responses. It verifies actual source geometry/confidence, unknown public heights, recorded floors/spaces/fictional parties, source bytes, fresh conflict computation, occupant search, source preview, PDF download, workspace/draft access and reload. ${v.requestFailures.length} request cancellations are retained in the report and are not disguised as successful requests.

Every pre-task database row is preserved, and all **497 original snapshot object keys** retain their exact bytes, content type and metadata. Lake View and Bronx remain populated. Current build and type checks passed; the source-credit, scenario-isolation and reference-evidence policy tests passed. Changes are local on branch **${branch}**; no push or public deployment was performed.

## Why no genuine owner/resident records?

The official Delhi land-record and NGDRS portals were inspected, but no validated mapping from these Google polygons to a particular cadastral/deed record or room was established. NGDRS e-search requires citizen details and OTP. No access barrier was bypassed. This is not a claim that registration records do not exist; it is a reason not to invent a real ownership association. All occupants in this demonstration are explicitly fictional shared-use entries.

## Important source limits

Google V3 inference was performed in May 2023; source imagery may be older. The download is not a 2026 survey. OSM road lines do not establish legal road-land width. The analysis-block boundary is not an official parcel. No real interiors, property type, inhabitants, land title or official ULPIN were inferred from the map. The Google-derived scene does not replace the existing OSM-only studies or Lake View.

Credit Google Research Open Buildings V3 for the predicted outlines and OpenStreetMap contributors for roads/selection context. The combined geographic inputs are provided under ODbL 1.0. Detailed URLs, local IDs, commands, provenance and limitations are in TECHNICAL_HANDOFF.md.

The scripts are copies of scripts/google-uttam in the repository. Reproduce through the repository paths described in the handoff; they are not standalone installers from this ZIP. Runtime checkpoints and environment credentials are intentionally excluded.

SHA256SUMS.txt covers the packaged files. The original raw browser WebM remains in the local evidence/google-final/video folder.
`;
await writeFile(resolve(out,'README.md'),readme);
async function walk(folder,prefix=''){const names=[];for(const item of await readdir(folder,{withFileTypes:true})){if(item.name==='SHA256SUMS.txt')continue;const name=prefix+item.name;if(item.isDirectory())names.push(...await walk(resolve(folder,item.name),name+'/'));else names.push(name);}return names;}
const sums=[];for(const name of(await walk(out)).sort()){assert(!/(^|\/)\.env|repo-data\.env/.test(name));const bytes=await readFile(resolve(out,name));if(/\.(json|txt|md|mjs|py)$/.test(name))assert(!/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/.test(bytes.toString('utf8')),'Credential URL in package');sums.push(createHash('sha256').update(bytes).digest('hex')+'  '+name);}
await writeFile(resolve(out,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log(JSON.stringify({result:'PASS',directory:out,files:sums.length+1,...summary.video},null,2));
