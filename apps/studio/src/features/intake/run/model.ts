import type { GetResponse, Schemas } from '@ulpin/api-client';
import { INTAKE_TARGET_LIMITS } from '../../../../../../packages/contracts/src/usp/intake';

export { INTAKE_TARGET_LIMITS };
export type TargetPage = GetResponse<'/api/v1/ingestion/cases/{caseId}/targets'>;
export type Target = TargetPage['items'][number];
// ZB1's fixed additive member; absence on an older read is not a refusal.
export type Package = TargetPage['packages'][number] & {
  reviewRefusal?: { code: string; message: string } | null;
};
export type Readiness = Target['readiness'];
export type Confirmation = GetResponse<'/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}'>;
export type ConfirmBody = Schemas['POST_ingestion_cases_caseId_confirmations_Request_application_json'];

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

export function reviewWords(pkg: Package): string | null {
  if (pkg.reviewRefusal) return pkg.reviewRefusal.message;
  if (!pkg.reviewFingerprint && pkg.state !== 'COMMITTED') return 'Its review has not run yet.';
  return null;
}

export function hasNoBuildings(pkg: Package): boolean {
  return Object.values(pkg.counts).every(count => count === 0);
}

export function confirmationWords(chosen: number): string {
  if (chosen === 0) return 'These packages will be recorded in the register. '
    + 'No building is chosen, so no card is made now.';
  return `These packages will be recorded in the register. The ${chosen} chosen buildings will then `
    + 'get a snapshot, an evidence plan and packet, and a property card made and verified without another press. '
    + 'Every other ready building of these packages will be recorded without a card.';
}

export function confirmingPackageWords(pkg: Package): string {
  if (hasNoBuildings(pkg)) return 'No building in this package; its features will be recorded.';
  return `${pkg.counts.ready} ready buildings will be recorded.`;
}

export function confirmablePackages(page: TargetPage): Package[] {
  return page.packages.filter((pkg: Package) => !pkg.reviewRefusal && pkg.state !== 'COMMITTED' && pkg.reviewFingerprint
    && (pkg.counts.ready > 0 || hasNoBuildings(pkg)));
}

type ChoiceTarget = Pick<Target, 'targetId' | 'packageId' | 'readiness'>;

export function chooseReady<T extends ChoiceTarget>(targets: readonly T[], packages: readonly Package[]): T[] {
  const permitted = new Set(packages.filter(pkg => !pkg.reviewRefusal && pkg.reviewFingerprint && pkg.state !== 'COMMITTED')
    .map(pkg => pkg.packageId));
  const unique = new Map(targets.filter(target => target.readiness === 'ready' && permitted.has(target.packageId))
    .map(target => [target.targetId, target]));
  return [...unique.values()].slice(0, INTAKE_TARGET_LIMITS.confirmationTargets);
}

export function confirmBody(page: TargetPage, choice: readonly ChoiceTarget[], acknowledgement: string,
  requestKey: string): ConfirmBody {
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
