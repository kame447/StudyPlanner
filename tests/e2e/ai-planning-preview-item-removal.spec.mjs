import { expect, test } from '@playwright/test';

async function seedPreviewRemovalState(page, { phase }) {
  await page.addInitScript(({ seededPhase }) => {
    const now = new Date().toISOString();
    const today = new Date();
    const user = {
      id: 'ai-planning-preview-removal-user',
      email: 'preview-removal@example.com',
      username: 'preview-removal-user',
      avatar: '',
      createdAt: now,
    };
    const toIsoDate = (value) => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const addDays = (value, amount) => {
      const next = new Date(value);
      next.setDate(next.getDate() + amount);
      return next;
    };
    const monday = new Date(today);
    const weekday = monday.getDay();
    monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
    const weekStartDate = toIsoDate(monday);
    const drafts = [
      {
        id: 'candidate-a',
        userId: user.id,
        date: toIsoDate(addDays(today, 1)),
        startTime: '09:00',
        endTime: '10:00',
        title: '金フレ A',
        subject: 'TOEIC',
        type: 'study',
        label: '金フレ',
        source: 'ai',
        status: 'draft',
        userEdited: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'candidate-b',
        userId: user.id,
        date: toIsoDate(addDays(today, 2)),
        startTime: '10:00',
        endTime: '11:00',
        title: '金フレ B',
        subject: 'TOEIC',
        type: 'study',
        label: '金フレ',
        source: 'ai',
        status: 'draft',
        userEdited: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const previewCandidates = drafts.map((block, index) => ({
      stableKey: block.id,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      durationMinutes: 60,
      title: block.title,
      field: block.subject,
      year: index + 1,
      estimatedMinutes: 60,
      source: 'weekly_exam_prep',
      approvalStatus: 'unapproved',
      workItemKey: `gold-phrase-${index + 1}`,
    }));
    const promoted = seededPhase === 'promoted';
    const planningState = {
      weekStartDate,
      revision: 1,
      conversationRequestSequence: 0,
      mode: promoted ? 'awaiting_approval' : 'draft_created',
      draftBlocks: promoted ? drafts : [],
      previewCandidates: promoted ? [] : previewCandidates,
      messages: [],
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
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
    window.__previewRemovalStorageKey = `studyplanner.weeklyPlanning.${user.id}.${weekStartDate}`;
  }, { seededPhase: phase });
}

async function readStoredPlanningState(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem(window.__previewRemovalStorageKey);
    if (!raw) return null;
    return JSON.parse(raw).payload.state;
  });
}

async function openPreview(page) {
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全2件');
  await preview.getByRole('tab', { name: '日別' }).click();
  return preview;
}

test('AI planning preview removes the exact local preview candidate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPreviewRemovalState(page, { phase: 'preview' });
  const preview = await openPreview(page);

  const removeCandidate = preview.getByRole('button', { name: '金フレ Aを計画から除外' });
  await expect(removeCandidate).toBeVisible();
  await removeCandidate.click();

  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全1件');
  await expect.poll(async () => {
    const state = await readStoredPlanningState(page);
    return {
      previewIds: state?.previewCandidates?.map((candidate) => candidate.stableKey) ?? [],
      draftIds: state?.draftBlocks?.map((block) => block.id) ?? [],
    };
  }).toEqual({
    previewIds: ['candidate-b'],
    draftIds: [],
  });
});

test('AI planning preview removes the exact promoted draft block', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPreviewRemovalState(page, { phase: 'promoted' });
  const preview = await openPreview(page);

  const removeDraft = preview.getByRole('button', { name: '金フレ Aを計画から除外' });
  await expect(removeDraft).toBeVisible();
  await removeDraft.click();

  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全1件');
  await expect.poll(async () => {
    const state = await readStoredPlanningState(page);
    return {
      previewIds: state?.previewCandidates?.map((candidate) => candidate.stableKey) ?? [],
      draftIds: state?.draftBlocks?.map((block) => block.id) ?? [],
    };
  }).toEqual({
    previewIds: [],
    draftIds: ['candidate-b'],
  });

  await preview.getByRole('tab', { name: '日別' }).click();
  await preview.getByRole('button', { name: '金フレ Bを計画から除外' }).click();
  await expect(preview).toBeHidden();
  await expect.poll(async () => {
    const state = await readStoredPlanningState(page);
    return {
      previewIds: state?.previewCandidates?.map((candidate) => candidate.stableKey) ?? [],
      draftIds: state?.draftBlocks?.map((block) => block.id) ?? [],
    };
  }).toEqual({
    previewIds: [],
    draftIds: [],
  });
});
