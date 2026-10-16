// The one reviewed processor image that the demo and every rehearsal run, named by the commit it was built from.
// The pin is a reviewed file in Git; an image carries the commit and the services/geo tree it was built from as
// labels, so that the doctor can tell an image that lags the serving checkout from the pinned one.
import { readFileSync } from 'node:fs';

export const pinFile = new URL('./processor-image.json', import.meta.url);
export const revisionLabel = 'org.opencontainers.image.revision';
export const treeLabel = 'in.bhuaayam.ulpin.services-geo-tree';
const hash = /^[0-9a-f]{40}$/;

/** The tag an image built from this commit carries: the repository name and the commit's first 12 digits. */
export function imageTag(commit) {
  if (!hash.test(commit)) throw new Error('A processor image is named by a full 40-digit commit.');
  return `ulpin-geo:git-${commit.slice(0, 12)}`;
}

/** The pin, checked: a full commit, its services/geo tree, and the tag named by that commit; nothing else. */
export function parsePin(value) {
  const keys = ['commit', 'servicesTree', 'image'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...keys].sort().join()) {
    throw new Error('The processor image pin holds exactly commit, servicesTree and image.');
  }
  if (!hash.test(value.servicesTree)) throw new Error('The pinned services tree is not a 40-digit tree hash.');
  if (value.image !== imageTag(value.commit)) {
    throw new Error(`The pinned image must be named by its commit: ${imageTag(value.commit)}.`);
  }
  return Object.freeze({ ...value });
}

export function readPin(file = pinFile) {
  return parsePin(JSON.parse(readFileSync(file, 'utf8')));
}

/** The two labels a pinned build writes, as docker build arguments. */
export function pinLabels(pin) {
  return { [revisionLabel]: pin.commit, [treeLabel]: pin.servicesTree };
}

const short = value => (value ? value.slice(0, 12) : 'none');

/**
 * Why an image is not the pinned one built from this checkout's services, or [] when it is. `labels` are the
 * image's labels (null when they could not be read); `servingTree` is the serving checkout's services/geo tree.
 */
export function imageProblems(name, labels, pin, servingTree) {
  const problems = [];
  const commit = labels?.[revisionLabel] ?? null;
  const tree = labels?.[treeLabel] ?? null;
  if (!commit || !tree) problems.push(`${name} carries no build commit; it is not a pinned build.`);
  else {
    if (commit !== pin.commit || tree !== pin.servicesTree) {
      problems.push(`${name} was built from ${short(commit)}, not the pinned ${short(pin.commit)}.`);
    }
    if (tree !== servingTree) {
      problems.push(`${name} is stale: its services/geo (${short(tree)}) differs from this checkout's `
        + `(${short(servingTree)}).`);
    }
  }
  return problems;
}

/**
 * Every reason the processors are not the pinned image built from the serving checkout, or [] when they are.
 * `processors` are the geo and worker containers as { service, image, labels }: image is the name the container
 * was created with.
 */
export function processorImageProblems(processors, pin, servingTree) {
  const problems = [];
  if (pin.servicesTree !== servingTree) {
    problems.push(`The pin (${short(pin.commit)}) lags this checkout: its services/geo differs; `
      + 'pin an image built from this commit.');
  }
  for (const service of ['geo', 'worker']) {
    const matches = processors.filter(processor => processor.service === service);
    if (matches.length !== 1) { problems.push(`Expected one ${service} container.`); continue; }
    const [processor] = matches;
    if (processor.image !== pin.image) problems.push(`${service} runs ${processor.image}, not the pinned ${pin.image}.`);
    problems.push(...imageProblems(`${service}'s image`, processor.labels, pin, servingTree));
  }
  return problems;
}
