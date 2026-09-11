import { expect, test } from '@playwright/test';

function toIsoDate(value) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function isoToday() {
  return toIsoDate(new Date());
}

function weekStartFor(value) {
  const monday = new Date(value);
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return toIsoDate(monday);
}

async function seedUser(page, { withPreview = false } = {}) {
  await page.addInitScript(({ today, weekStartDate, seedPreview }) => {
    const now = new Date().toISOString();
    const user = {
      id: 'schedule-drag-history-user',
      email: 'schedule-drag-history@example.com',
      username: 'schedule-drag-history',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'day-drag-plan',
      seriesId: 'day-drag-plan',
      userId: user.id,
      title: 'ドラッグ確認',
      subject: '数学',
      type: 'study',
      date: today,
      startTime: '09:00',
      endTime: '10:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      memo: '',
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');

    if (!seedPreview) return;

    const previewDate = today;
    const draftBlock = {
      id: 'preview-drag-block',
      userId: user.id,
      date: previewDate,
      startTime: '13:00',
      endTime: '14:00',
      title: '金フレ 1時間',
      subject: 'TOEIC',
      type: 'study',
      label: '金フレ',
      source: 'ai',
      status: 'draft',
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    };
    const planningState = {
      weekStartDate,
      revision: 1,
      conversationRequestSequence: 0,
      mode: 'draft_created',
      draftBlocks: [draftBlock],
      previewCandidates: [
        {
          stableKey: draftBlock.id,
          date: draftBlock.date,
          startTime: draftBlock.startTime,
          endTime: draftBlock.endTime,
          durationMinutes: 60,
          title: draftBlock.title,
          field: draftBlock.subject,
          year: 1,
          estimatedMinutes: 60,
          source: 'weekly_exam_prep',
          approvalStatus: 'unapproved',
          workItemKey: 'gold-phrase',
        },
      ],
      messages: [],
      updatedAt: now,
    };
    localStorage.setItem(
      `studyplanner.weeklyPlanning.${user.id}.${weekStartDate}`,
      JSON.stringify({
        version: 3,
        ownerId: user.id,
        payload: { version: 2, state: planningState },
      }),
    );
    localStorage.setItem(
      `studyplanner.weeklyPlanning.activeSession.${user.id}`,
      JSON.stringify({
        version: 1,
        ownerId: user.id,
        weekStartDate,
        conversationId: null,
      }),
    );
  }, {
    today: isoToday(),
    weekStartDate: weekStartFor(new Date()),
    seedPreview: withPreview,
  });
}

async function dragBy(locator, page, deltaX, deltaY) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 5 });
  await page.mouse.up();
}

async function readSeededPlanTime(page) {
  return page.evaluate(() => {
    const events = JSON.parse(
      localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]',
    );
    const event = events.find(
      (candidate) =>
        candidate.provenance?.legacy?.kind === 'plan' &&
        candidate.provenance?.legacy?.id === 'day-drag-plan',
    );
    return event ? `${event.startTime}-${event.endTime}` : null;
  });
}

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
}

test('day drag exposes icon history controls and undo/redo reapply the saved move', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedUser(page);
  await openSchedule(page);

  const dayTab = page.getByRole('tab', { name: '日', exact: true });
  if ((await dayTab.getAttribute('aria-selected')) !== 'true') {
    await dayTab.click();
  }

  const plan = page.locator('.timeline-plan-block').filter({ hasText: 'ドラッグ確認' });
  await expect(plan).toBeVisible();
  await expect(plan.locator('.timeline-entry-time')).toHaveText('09:00-10:00');

  const timelineBox = await page.locator('.timeline-canvas.split').boundingBox();
  expect(timelineBox).not.toBeNull();
  const oneHourPixels = timelineBox ? timelineBox.height / 24 : 0;
  await dragBy(plan, page, 0, oneHourPixels);
  await expect(plan.locator('.timeline-entry-time')).toHaveText('10:00-11:00');

  const undo = page.getByRole('button', { name: '変更を元に戻す' });
  const redo = page.getByRole('button', { name: '変更をやり直す' });
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(redo).toBeDisabled();
  await expect(undo).not.toContainText(/undo/i);
  await expect(redo).not.toContainText(/redo/i);

  await undo.click();
  await expect(plan.locator('.timeline-entry-time')).toHaveText('09:00-10:00');
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(plan.locator('.timeline-entry-time')).toHaveText('10:00-11:00');

  await page.locator('.schedule-day-strip button:not(.active)').first().click();
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => readSeededPlanTime(page)).toBe('09:00-10:00');
  await redo.click();
  await expect.poll(() => readSeededPlanTime(page)).toBe('10:00-11:00');

  const legacyPlanTime = await page.evaluate(() => {
    const plans = JSON.parse(localStorage.getItem('studyplanner.plans') ?? '[]');
    const legacy = plans.find((candidate) => candidate.id === 'day-drag-plan');
    return legacy ? `${legacy.startTime}-${legacy.endTime}` : null;
  });
  expect(legacyPlanTime).toBe('09:00-10:00');

  await page.getByRole('tab', { name: '月', exact: true }).click();
  await expect(page.getByRole('button', { name: '変更を元に戻す' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '変更をやり直す' })).toHaveCount(0);
});

test('AI preview drag keeps history across preview modes and clears it when the preview closes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedUser(page, { withPreview: true });
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').first().click();

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();

  const firstDate = preview.locator('.ai-planning-week-header > div').first();
  await firstDate.click();
  await expect(preview.getByRole('tab', { name: '日別' })).toHaveAttribute('aria-selected', 'true');

  const draft = preview.locator('.ai-planning-preview-day-column-detail .ai-planning-draft-block');
  await expect(draft).toHaveCount(1);
  await expect(draft.locator('small')).toHaveText('13:00-14:00');

  await dragBy(draft, page, 0, 38);
  await expect(draft.locator('small')).toHaveText('14:00-15:00');

  const undo = page.getByRole('button', { name: '変更を元に戻す' });
  const redo = page.getByRole('button', { name: '変更をやり直す' });
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(redo).toBeDisabled();

  await undo.click();
  await expect(draft.locator('small')).toHaveText('13:00-14:00');
  await redo.click();
  await expect(draft.locator('small')).toHaveText('14:00-15:00');

  await preview.getByRole('tab', { name: '全体' }).click();
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();

  await preview.getByRole('button', { name: '閉じる' }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByRole('button', { name: '変更を元に戻す' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '変更をやり直す' })).toHaveCount(0);
});
