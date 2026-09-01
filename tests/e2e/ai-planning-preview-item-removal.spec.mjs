import { expect, test } from '@playwright/test';

async function seedPreviewRemovalState(page, { phase }) {
  await page.addInitScript(({ seededPhase }) => {
    const seedMarker = 'studyplanner.e2e.previewRemovalSeeded';
    if (localStorage.getItem(seedMarker) === seededPhase) return;

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
    localStorage.setItem(seedMarker, seededPhase);
  }, { seededPhase: phase });
}

async function openPreview(page, expectedCount = 2) {
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-preview-total')).toContainText(`全${expectedCount}件`);
  await preview.getByRole('tab', { name: '日別' }).click();
  return preview;
}

async function longPressPreviewBlock(page, preview, title) {
  const block = preview
    .locator('.ai-planning-preview-day-column-detail .ai-planning-draft-block')
    .filter({ hasText: title });
  await expect(block).toBeVisible();
  const box = await block.boundingBox();
  if (!box) throw new Error(`Preview block is not measurable: ${title}`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  return block;
}

async function revealRemoveAction(page, preview, title) {
  const removeAction = preview.getByRole('button', { name: `${title}を計画から除外` });
  await expect(removeAction).toHaveCount(0);
  const block = await longPressPreviewBlock(page, preview, title);
  await expect(removeAction).toBeVisible();
  return { block, removeAction };
}

test('AI planning preview removes the exact local preview candidate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPreviewRemovalState(page, { phase: 'preview' });
  const preview = await openPreview(page);

  const firstReveal = await revealRemoveAction(page, preview, '金フレ A');
  await expect(firstReveal.block).toHaveCSS('padding-right', '7px');
  await page.waitForTimeout(100);
  await expect(firstReveal.removeAction).toBeVisible();

  await preview.getByRole('tab', { name: '全体' }).click();
  await preview.getByRole('tab', { name: '日別' }).click();
  await expect(preview.getByRole('button', { name: '金フレ Aを計画から除外' })).toHaveCount(0);

  const { removeAction: removeCandidate } = await revealRemoveAction(page, preview, '金フレ A');
  await removeCandidate.click();

  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全1件');

  const restoredPreview = await openPreview(page, 1);
  await expect(restoredPreview.getByRole('button', { name: '金フレ Aを計画から除外' })).toHaveCount(0);
  const { removeAction: remainingCandidate } = await revealRemoveAction(
    page,
    restoredPreview,
    '金フレ B',
  );
  await expect(remainingCandidate).toBeVisible();
});

test('AI planning preview removes the exact promoted draft block', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPreviewRemovalState(page, { phase: 'promoted' });
  const preview = await openPreview(page);

  const { removeAction: removeDraft } = await revealRemoveAction(page, preview, '金フレ A');
  await removeDraft.click();

  await expect(preview.locator('.ai-planning-preview-total')).toContainText('全1件');

  const restoredPreview = await openPreview(page, 1);
  await expect(restoredPreview.getByRole('button', { name: '金フレ Aを計画から除外' })).toHaveCount(0);
  const { removeAction: remainingDraft } = await revealRemoveAction(
    page,
    restoredPreview,
    '金フレ B',
  );
  await remainingDraft.click();
  await expect(restoredPreview).toBeHidden();

  await page.goto('/');
  await page.locator('.primary-bottom-nav button').first().click();
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
});
