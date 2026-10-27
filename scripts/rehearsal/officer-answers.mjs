// Rehearsal officer choices are supplied explicitly, never inferred from a file or a reading.
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
  const identifier = chooseOption(answer.options[1], supplied.identifierField, true);
  const name = chooseOption(answer.options[2], supplied.nameField, supplied.nameField !== null);
  if (identifier === null || name === null) return false;
  await selects[1].selectOption(identifier);
  await selects[2].selectOption(name);
  return true;
}

export async function answerLayout(page, file, supplied) {
  const retry = file.answer?.state === 'failed' && file.answer.usedAt === null && file.answer.tries < 5 && Date.now() - file.answer.triedAt > 20000;
  if (!supplied || supplied.file !== file.name || (file.answer && !retry) || file.layoutQuestionOffered == null
    || file.rowMatch?.kind !== 'one') return;
  const row = page.getByRole('region', { name: 'Files in this batch', exact: true }).locator('tbody tr')
    .filter({ has: page.getByRole('button', { name: file.name, exact: true }) });
  const view = row.getByRole('button', { name: 'View layout', exact: true });
  if (!await view.isVisible()) return;
  // A large file's form waits on its inventory, so a timed-out attempt is tried again, at most five times.
  const answer = file.answer = { offeredAt: file.layoutQuestionOffered, openedAt: null, usedAt: null,
    approvedAt: null, state: 'failed', answeredBy: 'rehearsal officer', alerts: [],
    tries: (file.answer?.tries ?? 0) + 1, triedAt: Date.now() };
  const layout = page.getByRole('region', { name: `Layout for ${file.name}`, exact: true });
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
