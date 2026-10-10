/**
 * K3e: Magnolia's stated finished floor levels as a cited level schedule proposal, dry run only.
 * Every literal is read back from the retained sheet's text layer; every number is computed here from it.
 * Nothing is sent anywhere: the printed request bodies are for the runtime owner.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  LevelScheduleContentSchema, LevelScheduleProposalSchema, LevelScheduleRequestSchema, NormalizedBuildingSchema,
  type BuildingCitation, type LevelSchedule, type LevelScheduleContent, type LevelScheduleRow,
  type NormalizedBuilding, type RegistryRecord,
} from '../../packages/contracts/src/index';
import { heightMetres } from '../../packages/server/src/modules/ai/document-storey-agent';
import {
  resolveScheduleHeights, reviewedLevelSchedule,
} from '../../packages/server/src/modules/officer/level-schedules';
import {
  applyLevelSchedules, assessSchedulePrisms,
} from '../../packages/server/src/modules/registry/canonical-level-schedule';
import { collectCanonicalCitationPins } from '../../packages/server/src/modules/registry/canonical-building';
import {
  BUILDING_CANDIDATE_MAX_PAGES,
} from '../../packages/server/src/modules/usp/ingestion/source-building-candidates';

const CITATIONS_PATH = 'docs/evidence/gf-t16/k3e/citations.json';
export const BUILDING_PATH = 'docs/evidence/gf-t16/k3b/magnolia-after-current.json';
const READER = 'docs/evidence/gf-t16/k3e/read-text-layer.py';
const PYTHON = 'E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe';
const DRY_RUN_ACTOR = 'k3e-dry-run';
export const VERTICAL_REFERENCE =
  'drawing-local: finished floor levels relative to the section\'s ground mark; not a surveyed height';
const AT_SEND = {
  revision: '<revisionId of the canonical building read just before sending>',
  proposal: '<proposal.proposalId of the propose receipt>',
};

type Box = [number, number, number, number];
type Pin = { levelId: string; lower: string; upper: string; arrow: string };
export type Citations = {
  task: 'K3e'; purpose: string;
  source: { sourceId: string; sourceRevision: number; sourceSha256: string; path: string; page: number };
  literals: Record<string, { box: Box; expected: string }>;
  reference: string; units: string; levels: Pin[];
};
type TextLine = { literal: string; bbox: number[] };

/** Input is checked where it matters: every literal against the sheet, every level against the schedule. */
export function readCitations(path = CITATIONS_PATH): Citations {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The retained original's page text, through the vector reader's own text helper, hash-checked around the read. */
export function readTextLayer(citations: Citations): TextLine[] {
  const { path, sourceSha256, page } = citations.source;
  const run = spawnSync(PYTHON, ['-B', READER, path, '--sha256', sourceSha256, '--page', String(page)], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CUDA_VISIBLE_DEVICES: '' },
  });
  if (run.status !== 0) throw new Error(`The text layer could not be read: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout).lines;
}

/** Each cited literal must be the text-layer line at exactly its box, with exactly its characters. */
export function verifyLiterals(citations: Citations, lines: TextLine[]): void {
  for (const [key, literal] of Object.entries(citations.literals)) {
    const line = lines.find(entry => entry.bbox.every((value, index) => value === literal.box[index]));
    if (!line) throw new Error(`No text-layer line at the box of ${key}; refusing to continue.`);
    if (line.literal !== literal.expected) {
      throw new Error(`${key} reads ${JSON.stringify(line.literal)}, not ${JSON.stringify(literal.expected)}.`);
    }
  }
}

const LEVEL_FORMS = [/^FFL ±(00)$/, /^FFL \+(\d+)'(\d+)"$/, /^(\d+)'-(\d+)"$/, /^(\d+)'$/];

/** Inches of the sheet's four level and interval forms: FFL ±00, FFL +11'6", 10'-7" and 10'. */
export function inchesOf(literal: string): number {
  for (const form of LEVEL_FORMS) {
    const match = form.exec(literal);
    if (!match) continue;
    const inches = Number(match[2] ?? 0);
    if (inches >= 12) throw new Error(`Inches out of range in ${literal}`);
    return Number(match[1]) * 12 + inches;
  }
  throw new Error(`Not a level or interval form of this sheet: ${literal}`);
}

/** Code-owned exact factor (inch = 0.0254 m) from the storey agent's conversion. */
export function metresOf(inches: number): number {
  const metres = heightMetres(inches, 'in');
  if (metres === null) throw new Error('The inch factor is missing.');
  return metres;
}

function feetAndInches(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Without sourceRevision, like the recorded schedule citations: a cited revision must stay current on every read. */
function cite(citations: Citations, key: string): BuildingCitation {
  const { sourceId, sourceSha256, page } = citations.source;
  const [x0, y0, x1, y1] = citations.literals[key].box;
  return { sourceId, sourceSha256,
    locator: { kind: 'region', page, x: x0, y: y0, width: x1 - x0, height: y1 - y0, unit: 'pt' } };
}

/** An arrow belongs to an interval only when its label sits between the two levels' labels on the section. */
function assertArrowBetween(citations: Citations, pin: Pin): void {
  const middle = (key: string) => (citations.literals[key].box[1] + citations.literals[key].box[3]) / 2;
  const arrow = middle(pin.arrow);
  if (!(arrow < middle(pin.lower) && arrow > middle(pin.upper))) {
    throw new Error(`${pin.arrow} does not sit between ${pin.lower} and ${pin.upper}.`);
  }
}

type Interval = { lowerIn: number; upperIn: number; arrowIn: number; agrees: boolean };

function intervalOf(citations: Citations, pin: Pin): Interval {
  assertArrowBetween(citations, pin);
  const lowerIn = inchesOf(citations.literals[pin.lower].expected);
  const upperIn = inchesOf(citations.literals[pin.upper].expected);
  const arrowIn = inchesOf(citations.literals[pin.arrow].expected);
  return { lowerIn, upperIn, arrowIn, agrees: upperIn - lowerIn === arrowIn };
}

/** Stated levels give both limits; where the printed arrow disagrees, both limits stay unknown with all cited. */
function levelRow(citations: Citations, current: LevelScheduleRow, pin: Pin): LevelScheduleRow {
  const interval = intervalOf(citations, pin);
  const keys = [citations.reference, pin.lower, pin.upper, pin.arrow, citations.units];
  const cited = keys.map(key => cite(citations, key));
  const row = { levelId: current.levelId, order: current.order, labelLiteral: current.labelLiteral,
    kind: current.kind, citations: [...current.citations, ...cited] };
  if (!interval.agrees) {
    return { ...row, lowerM: null, upperM: null, heightSource: 'unknown', verticalReference: null };
  }
  return { ...row, lowerM: metresOf(interval.lowerIn), upperM: metresOf(interval.upperIn),
    heightSource: 'stated', verticalReference: VERTICAL_REFERENCE };
}

/** Replaces the reviewed caption schedule row by row, keeping every level's identity, label, order and kind. */
export function scheduleContent(citations: Citations, building: NormalizedBuilding): LevelScheduleContent {
  const current = building.levelSchedule;
  if (current?.state !== 'reviewed') throw new Error('Magnolia has no reviewed level schedule to supersede.');
  const levels = current.levels.map(row => {
    const pin = citations.levels.find(entry => entry.levelId === row.levelId);
    if (!pin) throw new Error(`No cited levels for ${row.labelLiteral}.`);
    return levelRow(citations, row, pin);
  });
  return LevelScheduleContentSchema.parse({ state: 'reviewed', levels });
}

function intervalSentence(citations: Citations, pin: Pin, label: string): string {
  const interval = intervalOf(citations, pin);
  const [lower, upper, arrow] = [pin.lower, pin.upper, pin.arrow].map(key => citations.literals[key].expected);
  if (interval.agrees) return `${label}: ${lower} to ${upper}, matching the printed ${arrow}.`;
  return `${label}: ${lower} to ${upper} give ${feetAndInches(interval.upperIn - interval.lowerIn)} while the`
    + ` printed arrow says ${arrow}; the schedule does not choose and both limits stay unknown.`;
}

export function reviewReason(citations: Citations, content: LevelScheduleContent): string {
  const sentences = content.levels.map(row => intervalSentence(citations,
    citations.levels.find(pin => pin.levelId === row.levelId)!, row.labelLiteral));
  const units = citations.literals[citations.units].expected;
  const mark = citations.literals[citations.reference].expected;
  return [`Floor-to-floor limits from the section's stated finished floor levels ("${units}")`,
    `relative to its ground mark "${mark}": drawing-local, not clear height, not surveyed.`, ...sentences,
    'No unit number and no ground placement are claimed.'].join(' ');
}

export async function reviewInDryRun(building: NormalizedBuilding, content: LevelScheduleContent,
  reason: string): Promise<LevelSchedule> {
  const at = new Date().toISOString();
  const proposal = LevelScheduleProposalSchema.parse({ proposalId: randomUUID(), buildingId: building.buildingId,
    recordRevision: building.levelSchedule!.revision + 1, state: 'candidate',
    content: resolveScheduleHeights(content), actor: DRY_RUN_ACTOR, at });
  const schedule = reviewedLevelSchedule(building, proposal, reason, DRY_RUN_ACTOR, at, proposal.recordRevision + 1);
  schedule.prisms = await assessSchedulePrisms(building, schedule);
  return schedule;
}

/** The canonical projection the read path would serve, on the recorded building as the level-schedule tests do. */
export function project(building: NormalizedBuilding, schedule: LevelSchedule): NormalizedBuilding {
  const projected = structuredClone(building);
  const record = { id: building.buildingId, canonicalLevelSchedules: [schedule] } as unknown as RegistryRecord;
  applyLevelSchedules(projected, [record]);
  return NormalizedBuildingSchema.parse(projected);
}

function levelView(level: NormalizedBuilding['levels'][number]) {
  const region = (citation: BuildingCitation) => citation.locator.kind === 'region'
    ? [citation.locator.page, citation.locator.x, citation.locator.y, citation.locator.width, citation.locator.height]
    : citation.locator;
  return { label: level.label.value, lowerM: { value: level.lowerM.value, state: level.lowerM.state },
    upperM: { value: level.upperM.value, state: level.upperM.state }, heightSource: level.heightSource,
    heightState: level.heightState, citationsPageXYWHPt: level.lowerM.citations.map(region),
    prismAssessment: level.prismAssessment, roomCandidateIds: level.roomCandidateIds };
}

function requestBodies(building: NormalizedBuilding, content: LevelScheduleContent, reason: string) {
  const propose = LevelScheduleRequestSchema.parse({ action: 'propose', requestKey: randomUUID(),
    expectedCanonicalRevision: building.revisionId, content });
  const review = LevelScheduleRequestSchema.parse({ action: 'review', requestKey: randomUUID(),
    expectedCanonicalRevision: building.revisionId, proposalId: randomUUID(), reason });
  return { propose: { ...propose, expectedCanonicalRevision: AT_SEND.revision },
    review: { ...review, expectedCanonicalRevision: AT_SEND.revision, proposalId: AT_SEND.proposal } };
}

/** The offline half of verifyScheduleSources: each citation is a retained pin of this building, by page. */
export function citationsArePinned(building: NormalizedBuilding, content: LevelScheduleContent): boolean {
  const retained = collectCanonicalCitationPins(building);
  return content.levels.flatMap(row => row.citations).every(citation => (
    retained.get(citation.sourceId) === citation.sourceSha256
    && (citation.locator.kind === 'page' || citation.locator.kind === 'region')
    && citation.locator.page <= BUILDING_CANDIDATE_MAX_PAGES));
}

function conversions(citations: Citations) {
  return Object.entries(citations.literals).filter(([key]) => key !== citations.units).map(([key, literal]) => {
    const inches = inchesOf(literal.expected);
    return { key, literal: literal.expected, inches, metres: metresOf(inches) };
  });
}

async function dryRun(): Promise<unknown> {
  const citations = readCitations();
  verifyLiterals(citations, readTextLayer(citations));
  const building = NormalizedBuildingSchema.parse(JSON.parse(readFileSync(BUILDING_PATH, 'utf8')));
  const content = scheduleContent(citations, building);
  const reason = reviewReason(citations, content);
  const projected = project(building, await reviewInDryRun(building, content, reason));
  return { task: 'K3e', mode: 'dry-run', sent: false, literalsVerified: Object.keys(citations.literals).length,
    citationsArePinned: citationsArePinned(building, content), conversions: conversions(citations),
    intervals: citations.levels.map(pin => ({ levelId: pin.levelId, ...intervalOf(citations, pin) })),
    levels: projected.levels.map(levelView), requests: requestBodies(building, content, reason) };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--dry-run')) {
    throw new Error('Only --dry-run exists: the runtime owner sends the printed request bodies.');
  }
  process.stdout.write(`${JSON.stringify(await dryRun(), null, 1)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
