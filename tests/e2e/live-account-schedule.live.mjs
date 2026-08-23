import { expect, test } from '@playwright/test';

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for live-account verification.`);
  }
  return value;
}

const liveEmail = requireSecret('STUDYPLANNER_LIVE_EMAIL');
const livePassword = requireSecret('STUDYPLANNER_LIVE_PASSWORD');
const liveAccessKey = process.env.STUDYPLANNER_LIVE_ACCESS_KEY?.trim() ?? '';
const runId = process.env.GITHUB_RUN_ID?.trim() || `${Date.now()}`;
const eventTitle = `[E2E] live-account ${runId}`;

async function waitForAuthSurface(page) {
  const accessGateHeading = page.getByRole('heading', { name: '限定公開キー' });
  const loginTab = page.getByRole('tab', { name: 'ログイン', exact: true });

  await expect
    .poll(async () => {
      if (await accessGateHeading.isVisible()) return 'access-gate';
      if (await loginTab.isVisible()) return 'auth';
      return 'pending';
    }, { timeout: 20_000 })
    .not.toBe('pending');
}

async function unlockAccessGateIfNeeded(page) {
  const accessGateHeading = page.getByRole('heading', { name: '限定公開キー' });
  if (!(await accessGateHeading.isVisible())) {
    return;
  }

  if (!liveAccessKey) {
    throw new Error(
      'The production access gate is enabled, but STUDYPLANNER_LIVE_ACCESS_KEY is not configured.',
    );
  }

  await page.getByLabel('閲覧キー').fill(liveAccessKey);
  await page.getByRole('button', { name: 'キーを確認して進む' }).click();
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
}

async function signIn(page) {
  await page.goto('/');

  const primaryNav = page.locator('.primary-bottom-nav');
  if (await primaryNav.isVisible()) {
    return;
  }

  await waitForAuthSurface(page);
  await unlockAccessGateIfNeeded(page);

  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス').fill(liveEmail);
  await page.getByLabel('パスワード', { exact: true }).fill(livePassword);
  await page.getByRole('button', { name: 'ログインする' }).click();

  const privacyHeading = page.getByRole('heading', { name: '初回利用の確認' });
  const weekStartHeading = page.getByRole('heading', { name: '1週間の始まりを選択' });
  const authError = page.locator('.inline-error, .app-notice.error').first();

  await expect
    .poll(async () => {
      if (await primaryNav.isVisible()) return 'ready';
      if (await privacyHeading.isVisible()) return 'privacy-onboarding';
      if (await weekStartHeading.isVisible()) return 'week-start-onboarding';
      if (await authError.isVisible()) return 'auth-error';
      return 'pending';
    }, { timeout: 30_000 })
    .not.toBe('pending');

  if (await privacyHeading.isVisible()) {
    throw new Error(
      'The live account still requires the initial privacy consent. Complete it manually before running this verification.',
    );
  }

  if (await weekStartHeading.isVisible()) {
    throw new Error(
      'The live account still requires the initial week-start preference. Complete it manually before running this verification.',
    );
  }

  if (await authError.isVisible()) {
    throw new Error(
      'Live-account sign-in failed. Check the configured GitHub Actions credentials without exposing them in logs.',
    );
  }

  await expect(primaryNav).toBeVisible();
}

async function closeMonthEventEditorIfOpen(page) {
  const modal = page.locator('.month-event-modal-overlay');
  if (!(await modal.isVisible())) {
    return;
  }

  await modal.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(modal).not.toBeVisible();
}

async function ensureScheduleSurface(page) {
  await closeMonthEventEditorIfOpen(page);

  if (await page.locator('.schedule-month-view').isVisible()) {
    return;
  }

  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '予定' })
    .click();
  await expect(page.locator('.schedule-month-view')).toBeVisible();
}

async function openMonthEventEditor(page) {
  await ensureScheduleSurface(page);

  const trigger = page.locator('.quick-add-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: '予定を追加' }).click();
  await expect(page.locator('.month-event-modal-overlay')).toBeVisible();
}

function getTimelineEvent(page) {
  return page
    .locator('.month-event-timeline-item')
    .filter({ hasText: eventTitle });
}

async function createTestEvent(page) {
  await openMonthEventEditor(page);

  const modal = page.locator('.month-event-modal-overlay');
  await modal.getByLabel('タイトル').fill(eventTitle);

  const allDay = modal.locator('.month-event-all-day-switch input[type="checkbox"]');
  if (!(await allDay.isChecked())) {
    await allDay.check({ force: true });
  }

  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(
    page.getByText('月の主要予定を追加しました。', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

async function verifyTestEventVisible(page) {
  await openMonthEventEditor(page);
  const event = getTimelineEvent(page);
  await expect(event).toHaveCount(1);
  await expect(event).toBeVisible();
}

async function cleanupTestEvent(page, mustExist) {
  await openMonthEventEditor(page);
  const event = getTimelineEvent(page);
  const count = await event.count();

  if (count === 0) {
    if (mustExist) {
      throw new Error('The live test event disappeared before cleanup could verify deletion.');
    }
    await closeMonthEventEditorIfOpen(page);
    return;
  }

  if (count !== 1) {
    throw new Error('Live-account cleanup found more than one event with the unique test title.');
  }

  await event.click();

  const modal = page.locator('.month-event-modal-overlay');
  const deleteButton = modal
    .locator('.month-event-editor-actions')
    .getByRole('button', { name: '削除', exact: true });

  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await deleteButton.click();

  await expect(modal).not.toBeVisible();
  await expect(page.getByText('削除しました', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await openMonthEventEditor(page);
  await expect(getTimelineEvent(page)).toHaveCount(0);
  await closeMonthEventEditorIfOpen(page);
}

test('real account can create, verify, and remove one isolated production event', async ({
  page,
}) => {
  let signedIn = false;
  let creationConfirmed = false;
  let primaryError = null;
  let cleanupError = null;

  try {
    await signIn(page);
    signedIn = true;
    await createTestEvent(page);
    creationConfirmed = true;
    await verifyTestEventVisible(page);
  } catch (error) {
    primaryError = error;
  } finally {
    if (signedIn) {
      try {
        await cleanupTestEvent(page, creationConfirmed);
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Live-account verification failed and cleanup also failed.',
    );
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
});
