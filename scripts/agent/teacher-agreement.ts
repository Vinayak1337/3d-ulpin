import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL_TARGETS } from '../../packages/contracts/src/index';
import { digest, T1_ROOT } from './t1-sources';
import { saveNew } from './t1-profiles';

type Pair = { profileId: string; header: string; leadTarget: string; publisherMeaning: string;
  dictionaryCitation: unknown; classification: 'agree' | 'disagree' | 'not_comparable'; reason: string };
const readLines = (path: string) => readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));

function literalConcept(meaning: string): { target?: string; reason: string } {
  const literal = meaning.normalize('NFKC').toLowerCase();
  if (literal === 'name of building') return { target: 'building.name', reason: 'Literal names a building.' };
  if (literal === 'registration no.') {
    return { target: 'document.registrationNo', reason: 'Literal names a registration number.' };
  }
  if (literal === 'sanctioned no. of floors') {
    return { target: 'building.storeyCount', reason: 'Number of floors names a count, not a storey expression.' };
  }
  if (literal === 'project name' || literal === 'year') {
    return { reason: 'Project identity or undifferentiated year does not uniquely identify a canonical concept.' };
  }
  if (/carpet area/.test(literal)) return { target: 'unit.carpetArea', reason: 'Literal names carpet area.' };
  if (/balcony/.test(literal)) return { target: 'unit.balconyArea', reason: 'Literal names balcony area.' };
  if (/date of registration/.test(literal)) return { target: 'document.date', reason: 'Literal names registration date.' };
  if (literal === 'project address') {
    return { reason: 'Project address is not explicitly a building address in the literal definition.' };
  }
  if (/^(?:type of apartment)/.test(literal)) return { target: 'unit.type', reason: 'Literal names apartment type.' };
  return { target: 'unknown', reason: 'Literal describes agriculture, aggregate inventory or an unsupported concept.' };
}

function classify(leadTarget: string, meaning: string): Pick<Pair, 'classification' | 'reason'> {
  const concept = literalConcept(meaning);
  if (!concept.target) return { classification: 'not_comparable', reason: concept.reason };
  if (!(concept.target in CANONICAL_TARGETS)) throw new Error('AGREEMENT_TARGET_OUTSIDE_CONTRACT');
  return { classification: leadTarget === concept.target ? 'agree' : 'disagree', reason: concept.reason };
}

function counts(pairs: Pair[]) {
  return { agree: pairs.filter(pair => pair.classification === 'agree').length,
    disagree: pairs.filter(pair => pair.classification === 'disagree').length,
    not_comparable: pairs.filter(pair => pair.classification === 'not_comparable').length };
}

function main() {
  const verification = JSON.parse(readFileSync('docs/evidence/gf-agent/t1/verify.json', 'utf8'));
  const output = verification.outputDirectory as string;
  const links = readLines(join(output, 'profile-links.jsonl'));
  const examples = readLines(join(output, 'pseudo-labels.jsonl'));
  const meaningsPath = join(T1_ROOT, 'publisher/publisher-meaning.jsonl');
  const pairs: Pair[] = [];
  for (const meaning of readLines(meaningsPath)) {
    const link = links.find(link => link.profileId === meaning.profileId);
    const example = examples.find(example => example.profileHash === link?.profileHash &&
      example.columnProfile.name === link?.sourceField && example.verified === true);
    if (!example) continue;
    pairs.push({ ...meaning, header: link.header, leadTarget: example.target,
      ...classify(example.target, meaning.publisherMeaning) });
  }
  const pairPath = join(output, 'publisher-agreement.jsonl');
  saveNew(pairPath, pairs, true);
  const evidence = { task: 'A4-step-1', method: 'literal-only concept comparison; no outside source knowledge',
    qualification: 'Measures pseudo-label teacher agreement, not student evaluation truth; labels unchanged.',
    compared: pairs.length, dictionaryEntries: 57, excludedUnverified: 57 - pairs.length,
    counts: counts(pairs), positives: counts(pairs.filter(pair => pair.leadTarget !== 'unknown')),
    unknown: counts(pairs.filter(pair => pair.leadTarget === 'unknown')),
    disagreements: pairs.filter(pair => pair.classification === 'disagree'),
    pairLedger: pairPath, pairLedgerSha256: digest(pairPath), meaningsSha256: digest(meaningsPath),
    teacherLabelsSha256: verification.teacherLabelsSha256,
  };
  writeFileSync('docs/evidence/gf-agent/t1/agreement.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ compared: pairs.length, counts: evidence.counts }));
}

main();
