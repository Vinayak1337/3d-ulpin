import type { GetResponse, Schemas } from '@ulpin/api-client';
import { INTAKE_TARGET_LIMITS } from '@ulpin/contracts/upload-reader-limits';

export { INTAKE_TARGET_LIMITS };
export type TargetPage = GetResponse<'/api/v1/ingestion/cases/{caseId}/targets'>;
export type Target = TargetPage['items'][number];
export type Package = TargetPage['packages'][number];
export type Readiness = Target['readiness'];
export type Confirmation = GetResponse<'/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}'>;
export type ConfirmBody = Schemas['POST_ingestion_cases_caseId_confirmations_Request_application_json'];

/** A target read lists at most this many packages, as many as one confirmation names. */
export const PACKAGE_PAGE = 100;

export const readinessWords: Record<Readiness, string> = {
  preparing: 'The package is being prepared for review.',
  ready: 'Ready to record and make a card.',
  needs_answer: 'An answer is needed before this building can continue.',
  held: 'This building cannot continue with the current evidence.',
  confirmed: 'The officer has confirmed this building for a card.',
  recorded: 'This building is in the register.',
  carded: 'Its property card is made and verified.',
  stopped: 'Work stopped; the completed steps are kept.',
};

export const readinessLabels: Record<Readiness, string> = {
  preparing: 'Being prepared', ready: 'Ready to record', needs_answer: 'Needs an answer', held: 'Held',
  confirmed: 'Confirmed for a card', recorded: 'Recorded', carded: 'Card made and verified', stopped: 'Stopped',
};

export const stageWords: Record<number, string> = {
  1: 'Read the source', 2: 'Draft the package', 3: 'Record in the register', 4: 'Link supporting records',
  5: 'Keep a snapshot of the record', 6: 'Check whether an identity applies',
  7: 'Make the evidence plan and packet', 8: 'Make and verify the property card',
};

const notRunWords = 'Its review has not run yet.';

export function reviewWords(pkg: Package): string | null {
  if (pkg.reviewRefusal) return pkg.reviewRefusal.message;
  if (!pkg.reviewFingerprint && pkg.state !== 'COMMITTED') return notRunWords;
  return null;
}

/**
 * The stored target reasons shown under a package's review line. A refusal says only its message. Before the review
 * runs, a waiting target stores "The package review has not run…" (intake-targets.ts); the review line already says
 * so, so that reason is shown once, as the review line.
 */
export function reasonsBesideReview(pkg: Package, reasons: readonly string[]): readonly string[] {
  if (pkg.reviewRefusal) return [];
  if (reviewWords(pkg) !== notRunWords) return reasons;
  return reasons.filter(reason => !/^The package review has not run\b/.test(reason));
}

export function hasNoBuildings(pkg: Package): boolean {
  return Object.values(pkg.counts).every(count => count === 0);
}

export const nothingDraftedWords = 'No buildings are drafted from this batch yet.';

/** No package is listed and every count is 0: nothing is drafted from the batch. */
export function nothingDrafted(page: TargetPage): boolean {
  return page.packages.length === 0 && Object.values(page.counts).every(count => count === 0);
}

export function confirmationFacts(packages: readonly Package[], chosen: number) {
  const counted = (count: number, word: string) => `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`;
  return {
    buildings: counted(packages.reduce((sum, pkg) => sum + pkg.counts.ready, 0), 'building'),
    files: counted(new Set(packages.map(pkg => pkg.anchorItemId)).size, 'file'),
    cards: counted(chosen, 'card'),
  };
}

type ConfirmationFacts = ReturnType<typeof confirmationFacts>;

export function confirmationWords(facts: ConfirmationFacts): string {
  return `You will record ${facts.buildings} from ${facts.files} and make ${facts.cards}`;
}

export function acknowledgementWords(facts: ConfirmationFacts): string {
  return `I confirm ${facts.buildings} from ${facts.files} for recording, with ${facts.cards}; `
    + 'no rights or ownership are set.';
}

/** A cards-only confirmation records nothing and cards its buildings in the order listed. */
export function cardsOnlyWords(chosen: number): string {
  if (chosen === 1) return 'This recorded building will get a snapshot, an evidence plan and packet, and a property '
    + 'card made and verified, without another press. Nothing is recorded again.';
  return `These ${chosen} recorded buildings will each get a snapshot, an evidence plan and packet, and a property `
    + 'card made and verified, in the order listed, without another press. Nothing is recorded again.';
}

export function remainingPackagesWords(listed: number, after: number): string {
  return `After these ${listed} packages, ${after} more packages of this batch are not yet recorded.`;
}

export function noCardWords(counts: TargetPage['counts']): string {
  return `${counts.recorded} recorded buildings have no card yet.`;
}

export function hasRecordedPackage(page: TargetPage): boolean {
  return page.packages.some(pkg => pkg.state === 'COMMITTED');
}

type CardTarget = Pick<Target, 'targetId' | 'readiness'> & Partial<Pick<Target, 'confirmationId'>>;

/** Recorded buildings no confirmation lists yet, in the order the batch stores them, at most one confirmation's. */
export function nextRecorded<T extends CardTarget>(targets: readonly T[]): T[] {
  const unique = new Map(targets.filter(target => target.readiness === 'recorded' && !target.confirmationId)
    .map(target => [target.targetId, target]));
  return [...unique.values()].slice(0, INTAKE_TARGET_LIMITS.confirmationTargets);
}

/** Another stored confirmation's run is recording this package; it is named again only after that run ends. */
export function isBeingRecorded(pkg: Pick<Package, 'recordingConfirmationId'>): boolean {
  return Boolean(pkg.recordingConfirmationId);
}

/** The packages of the page another confirmation's run is recording. */
export function beingRecorded(packages: readonly Package[]): ReadonlySet<string> {
  return new Set(packages.filter(isBeingRecorded).map(pkg => pkg.packageId));
}

export function confirmingPackageWords(pkg: Package): string {
  if (hasNoBuildings(pkg)) return 'No building in this package; its features will be recorded.';
  return `${pkg.counts.ready} ready buildings will be recorded.`;
}

export function confirmablePackages(page: TargetPage): Package[] {
  return page.packages.filter(pkg => !pkg.reviewRefusal && pkg.state !== 'COMMITTED' && pkg.reviewFingerprint
    && !isBeingRecorded(pkg) && (pkg.counts.ready > 0 || hasNoBuildings(pkg)));
}

type ChoiceTarget = Pick<Target, 'targetId' | 'packageId' | 'readiness'>;

export function chooseReady<T extends ChoiceTarget>(targets: readonly T[], packages: readonly Package[]): T[] {
  const permitted = new Set(packages.filter(pkg => !pkg.reviewRefusal
    && pkg.reviewFingerprint && pkg.state !== 'COMMITTED' && !isBeingRecorded(pkg))
    .map(pkg => pkg.packageId));
  const unique = new Map(targets.filter(target => target.readiness === 'ready' && permitted.has(target.packageId))
    .map(target => [target.targetId, target]));
  return [...unique.values()].slice(0, INTAKE_TARGET_LIMITS.confirmationTargets);
}

/** A cards-only confirmation: no package, the recorded buildings with no card it names, in order. */
export function cardsBody(choice: readonly CardTarget[], acknowledgement: string, requestKey: string): ConfirmBody {
  return { requestKey, acknowledgement, packages: [], targets: nextRecorded(choice).map(target => target.targetId) };
}

export function confirmBody(page: TargetPage, choice: readonly (ChoiceTarget & CardTarget)[],
  acknowledgement: string, requestKey: string, cardsOnly = false): ConfirmBody {
  if (cardsOnly) return cardsBody(choice, acknowledgement, requestKey);
  const packages = confirmablePackages(page);
  return {
    requestKey, acknowledgement,
    packages: packages.map(pkg => ({ packageId: pkg.packageId, revision: pkg.revision,
      reviewFingerprint: pkg.reviewFingerprint! })),
    targets: chooseReady(choice, packages).map(target => target.targetId),
  };
}

export function confirmationIds(targets: readonly Pick<Target, 'confirmationId'>[]): string[] {
  return [...new Set(targets.flatMap(target => target.confirmationId ? [target.confirmationId] : []))];
}

export function countsLine(counts: TargetPage['counts']): string {
  return (Object.keys(readinessLabels) as Readiness[])
    .map(readiness => `${counts[readiness]} ${readinessLabels[readiness].toLowerCase()}`).join(' · ');
}

export function shouldRefetch(progress: readonly Pick<Target, 'readiness'>[], lastActivity: number,
  now: number): boolean {
  return progress.some(target => !['carded', 'stopped'].includes(target.readiness)) && now - lastActivity >= 5000;
}

export function waitingReason(target: Target): string | null {
  return ['preparing', 'needs_answer', 'held', 'confirmed', 'stopped'].includes(target.readiness)
    ? target.reason : null;
}
