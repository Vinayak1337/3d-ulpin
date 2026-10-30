// Rehearsal officer choices are supplied explicitly, never inferred from a file or a reading.
import { readFile } from 'node:fs/promises';
import { win32 } from 'node:path';
import { checkedPath, runtimePlan } from './kit-manifest.mjs';
import { observation } from './presenter.mjs';

export async function readOfficerAnswers(path, runtime) {
  runtimePlan(runtime, 'E:/ulpin-tmp/answers-guard');
  const body = JSON.parse(await readFile(await checkedPath(win32.resolve(path)), 'utf8'));
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const targets = new Set();
  if (body?.version !== 'rehearsal-officer-answers/1' || body.test_only !== true
    || !Array.isArray(body.answers)) throw new Error('Invalid rehearsal officer answers');
  for (const answer of body.answers) {
    const byField = text(answer?.identifierField) && answer.identifierBy === undefined;
    const byPosition = answer?.identifierField === null && answer.identifierBy === 'position';
    const key = JSON.stringify([answer?.file, answer?.layer ?? null]);
    if (!text(answer?.file) || !text(answer?.kind) || !(byField || byPosition)
      || !(answer.nameField === null || text(answer.nameField)) || targets.has(key)
      || (answer.layer !== undefined && (!Number.isSafeInteger(answer.layer) || answer.layer < 1))) {
      throw new Error('Invalid or duplicate rehearsal officer answer fields');
    }
    targets.add(key);
  }
  return body;
}

export async function matchOfficerAnswers(result, items, readLayers) {
  if (!result.officerAnswers) return;
  const previous = result.officerAnswers.matches ?? [];
  const layers = new Map();
  const claims = [];
  for (const [answerIndex, supplied] of result.officerAnswers.answers.entries()) {
    const parents = result.files.filter(file => file.name === supplied.file);
    const originals = items.filter(item => item.name === supplied.file && !item.parentItemId && !item.archiveItemId);
    let candidates = supplied.layer === undefined ? originals : [];
    if (supplied.layer !== undefined && parents.length === 1 && originals.length === 1) {
      const pinned = previous[answerIndex]?.itemId;
      if (pinned) candidates = items.filter(item => item.itemId === pinned);
      else {
        const parent = originals[0];
        if (!layers.has(parent.itemId)) layers.set(parent.itemId, await readLayers(parent));
        const sources = (layers.get(parent.itemId) ?? []).filter(layer => layer.ordinal + 1 === supplied.layer);
        if (sources.length === 1) candidates = items.filter(item => item.itemId !== parent.itemId
          && item.sourceId === sources[0].derivativeSourceId);
      }
    }
    claims.push({ answerIndex, parent: parents.length === 1 ? parents[0] : null,
      item: parents.length === 1 && candidates.length === 1 ? candidates[0] : null });
  }
  result.officerAnswers.matches = claims.map(({ answerIndex, parent, item }) => {
    if (!item || claims.filter(claim => claim.item?.itemId === item.itemId).length !== 1) {
      return { answerIndex, state: 'unmatched', reason: 'No unique intake row for this officer answer.' };
    }
    const supplied = result.officerAnswers.answers[answerIndex];
    if (supplied.layer !== undefined) {
      let member = parent.members.find(member => member.itemId === item.itemId);
      if (!member) parent.members.push(member = { ...observation(item.name), itemId: item.itemId });
      Object.assign(member, { parentFile: supplied.file, layer: supplied.layer });
    }
    return { answerIndex, state: 'matched', itemId: item.itemId };
  });
}

export function suppliedAnswer(result, file) {
  const match = result.officerAnswers?.matches?.find(match =>
    match.state === 'matched' && match.itemId === file.itemId);
  return match ? result.officerAnswers.answers[match.answerIndex] : null;
}

const labels = ['What is each feature in this file?', 'Which field identifies each one?', 'Which field is its name?'];

export function chooseOption(options, field, property = false) {
  const matches = options.filter(option => property ? option.value.endsWith(`/properties/${field}`)
    : option.value === (field ?? ''));
  return matches.length === 1 && !matches[0].disabled ? matches[0].value : null;
}

export function officerSeconds(answer) {
  const end = answer.approvedAt ?? answer.usedAt;
  return end == null || answer.offeredAt == null ? null : (end - answer.offeredAt) / 1000;
}

async function optionsSeen(selects) {
  return Promise.all(selects.map(select => select.evaluate(element => Array.from(element.options, option => ({
    value: option.value, text: option.textContent,
    disabled: element.matches(':disabled') || option.matches(':disabled'),
  })))));
}

async function settle(page, layout, press) {
  await page.waitForFunction(({ label, press }) => {
    const section = Array.from(document.querySelectorAll('section'))
      .find(node => node.getAttribute('aria-label') === label);
    if (!section) return false;
    const alerts = Array.from(section.querySelectorAll('[role=alert], [role=status]'));
    if (alerts.some(node => node.textContent)) return true;
    return !Array.from(section.querySelectorAll('button')).some(button =>
      [press, 'Using this layout…', 'Approving layout…'].includes(button.textContent.trim()));
  }, { label: await layout.getAttribute('aria-label'), press }, { timeout: 30000 });
  const alerts = await layout.getByRole('alert').allTextContents();
  const status = await layout.getByRole('status').allTextContents();
  if (alerts.length || status.length) {
    throw Object.assign(new Error('Layout answer did not complete'), { alerts, status });
  }
}

async function fillAnswers(layout, supplied, answer) {
  const selects = labels.map(label => layout.getByRole('combobox', { name: label, exact: true }));
  await selects[0].waitFor({ state: 'visible', timeout: 30000 });
  answer.options = await optionsSeen(selects);
  const kind = chooseOption(answer.options[0], supplied.kind);
  if (kind === null) return false;
  await selects[0].selectOption(kind);
  answer.options = await optionsSeen(selects);
  // apps/studio/src/features/intake/question-model.ts positionPath.
  const positionPath = '/features/*/geometry';
  const byPosition = supplied.identifierBy === 'position';
  const identifier = byPosition ? chooseOption(answer.options[1], positionPath)
    : chooseOption(answer.options[1], supplied.identifierField, true);
  if (byPosition && identifier === null) answer.error = 'Position in the file is not offered for this layout.';
  const name = chooseOption(answer.options[2], supplied.nameField, supplied.nameField !== null);
  if (identifier === null || name === null) return false;
  await selects[1].selectOption(identifier);
  await selects[2].selectOption(name);
  return true;
}

/** `name` is the intake item's own name, which the batch row and the layout show; a member may keep a generic one. */
export async function answerLayout(page, file, supplied, name = file.name) {
  const retry = file.answer?.state === 'failed' && file.answer.usedAt === null && file.answer.tries < 5
    && Date.now() - file.answer.triedAt > 20000;
  if (!supplied || supplied.file !== (file.parentFile ?? file.name)
    || (supplied.layer ?? null) !== (file.layer ?? null) || (file.answer && !retry)
    || file.layoutQuestionOffered == null
    || file.rowMatch?.kind !== 'one') return;
  const row = page.getByRole('region', { name: 'Files in this batch', exact: true }).locator('tbody tr')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
  const view = row.getByRole('button', { name: 'View layout', exact: true });
  if (!await view.isVisible()) return;
  // A large file's form waits on its inventory, so a timed-out attempt is tried again, at most five times.
  const answer = file.answer = { offeredAt: file.layoutQuestionOffered, openedAt: null, usedAt: null,
    approvedAt: null, state: 'failed', answeredBy: 'rehearsal officer', alerts: [],
    tries: (file.answer?.tries ?? 0) + 1, triedAt: Date.now() };
  const layout = page.getByRole('region', { name: `Layout for ${name}`, exact: true });
  try {
    await view.click();
    answer.openedAt = Date.now();
    await layout.waitFor({ state: 'visible', timeout: 30000 });
    file.layoutQuestionShown ??= Date.now();
    if (!await fillAnswers(layout, supplied, answer)) {
      answer.state = 'unavailable';
      return;
    }
    await layout.getByRole('button', { name: 'Use this layout', exact: true }).click();
    answer.usedAt = Date.now();
    await settle(page, layout, 'Use this layout');
    answer.state = 'used';
    const approve = layout.getByRole('button', { name: 'Approve layout', exact: true });
    if (await approve.isVisible()) {
      await approve.click();
      const pressedAt = Date.now();
      await settle(page, layout, 'Approve layout');
      answer.approvedAt = pressedAt;
      answer.state = 'approved';
    }
  } catch (error) {
    answer.state = 'failed';
    answer.alerts = error.alerts ?? await layout.getByRole('alert').allTextContents().catch(() => []);
    answer.status = error.status ?? [];
    answer.error = error.message;
  } finally {
    file.officerSeconds = officerSeconds(answer);
  }
}
