import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html';

test.describe.configure({ retries: 0 });

async function events(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function releaseRuntime(page) {
  const released = await page.evaluate(() => window.__realWeeklyRuntime.release());
  expect(released).toBe(true);
}

async function enterWeeklyMode(page) {
  const input = page.getByLabel('週間計画にしたいこと');
  if (await input.isVisible().catch(() => false)) {
    return input;
  }

  const aiInput = page.getByRole('button', { name: 'AI入力', exact: true });
  if (await aiInput.count() && await aiInput.isVisible()) {
    await aiInput.click();
  }

  const weeklyMode = page.getByRole('button', { name: '週間計画', exact: true });
  if (await weeklyMode.count() && await weeklyMode.isVisible()) {
    await weeklyMode.click();
  }

  await expect(input).toBeVisible();
  return input;
}

async function submitWeekly(page, text) {
  const input = await enterWeeklyMode(page);
  await input.fill(text);
  await input.press('Control+Enter');
}

async function waitForRuntimePending(page) {
  await expect.poll(
    () => page.evaluate(() => window.__realWeeklyRuntime.pending()),
  ).toBe(1);
}

async function createPreview(page, text = 'previewを作る条件') {
  await submitWeekly(page, text);
  await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  await expect(page.getByText('数学のワーク', { exact: true })).toBeVisible();
}

async function promoteAndApprovePreview(page) {
  expect(await events(page, 'real-save-approved-plan')).toHaveLength(0);

  await page.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
  expect(await events(page, 'real-save-approved-plan')).toHaveLength(0);

  await page.getByRole('button', { name: '一括承認して保存' }).click();
  await expect.poll(async () => (await events(page, 'real-save-approved-plan')).length).toBe(1);
  await expect(page.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
}

test.describe('real weekly application browser lifecycle', () => {
  test('a completed turn crosses the real application/controller/reducer boundary once', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    await submitWeekly(page, '最初の条件');

    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);
    await expect(page.getByText('最初の条件', { exact: true })).toHaveCount(1);
    await expect(page.getByText('テスト応答: 最初の条件', { exact: true })).toHaveCount(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(1);
  });

  test('two sequential turns preserve user-assistant ordering without replay or duplication', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);

    await submitWeekly(page, '1つ目の条件');
    await expect(page.getByText('テスト応答: 1つ目の条件', { exact: true })).toBeVisible();
    await submitWeekly(page, '2つ目の条件');
    await expect(page.getByText('テスト応答: 2つ目の条件', { exact: true })).toBeVisible();

    await expect(page.getByText('1つ目の条件', { exact: true })).toHaveCount(1);
    await expect(page.getByText('2つ目の条件', { exact: true })).toHaveCount(1);
    await expect(page.getByText('テスト応答: 1つ目の条件', { exact: true })).toHaveCount(1);
    await expect(page.getByText('テスト応答: 2つ目の条件', { exact: true })).toHaveCount(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(2);
    expect(await events(page, 'real-runtime-complete')).toHaveLength(2);

    const roles = await page.getByLabel('週間計画の会話履歴').locator('strong').allTextContents();
    expect(roles).toEqual(['あなた', 'アプリ', 'あなた', 'アプリ']);
  });

  test('canceling an in-flight turn causes the real controller to discard its late runtime result', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
    await submitWeekly(page, 'キャンセルする条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: '処理をキャンセル' }).click();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await expect(page.getByText('テスト応答: キャンセルする条件', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('週間計画にしたいこと')).toBeVisible();
  });

  test('a canceled staged graph does not advance the next accepted runtime revision', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
    await submitWeekly(page, '破棄される条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: '処理をキャンセル' }).click();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await page.evaluate(() => {
      window.history.replaceState(null, '', '/real-weekly.html');
    });
    await submitWeekly(page, '採用される条件');
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(2);

    const completions = await events(page, 'real-runtime-complete');
    expect(completions[0].payload.graphRevision).toBe(1);
    expect(completions[1].payload.graphRevision).toBe(1);
    await expect(page.getByText('テスト応答: 採用される条件', { exact: true })).toHaveCount(1);
  });

  test('closing the modal during a real in-flight turn does not lose the committed result', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
    await submitWeekly(page, '閉じても残る条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await page.getByRole('button', { name: 'モーダルを再度開く' }).click();
    await expect(page.getByText('閉じても残る条件', { exact: true })).toHaveCount(1);
    await expect(page.getByText('テスト応答: 閉じても残る条件', { exact: true })).toHaveCount(1);
  });

  test('a preview returned while the modal is closed survives through the real application state', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly&preview=1`);
    await submitWeekly(page, 'previewを作る条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: '閉じる' }).click();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await page.getByRole('button', { name: 'モーダルを再度開く' }).click();
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect(page.getByText('数学のワーク', { exact: true })).toBeVisible();
  });

  test('clearing conversation history preserves an already-created preview', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    await createPreview(page, '履歴だけ消す条件');

    const cleared = await page.evaluate(() => window.__realWeeklyActions.clearConversation());
    expect(cleared).toBe(true);

    await expect(page.getByText('履歴だけ消す条件', { exact: true })).toHaveCount(0);
    await expect(page.getByText('テスト応答: 履歴だけ消す条件', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect(page.getByText('数学のワーク', { exact: true })).toBeVisible();
  });

  test('reset clears conversation and preview state and the cleared state stays cleared after reload', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    await createPreview(page, 'リセットする条件');

    await page.evaluate(() => window.__realWeeklyActions.resetSession());

    await expect(page.getByText('リセットする条件', { exact: true })).toHaveCount(0);
    await expect(page.getByText('テスト応答: リセットする条件', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toHaveCount(0);
    await expect(page.getByText('数学のワーク', { exact: true })).toHaveCount(0);

    await page.reload();

    await expect(page.getByText('リセットする条件', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toHaveCount(0);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
  });

  test('preview promotion and approval cross the real application save boundary once', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    await createPreview(page, '保存まで進める条件');
    await promoteAndApprovePreview(page);

    const saved = (await events(page, 'real-save-approved-plan'))[0].payload;
    expect(saved).toMatchObject({
      title: '数学のワーク',
      date: '2026-08-18',
      startTime: '19:00',
      endTime: '20:00',
    });
  });

  test('a completed conversation is restored after a full browser reload', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    await submitWeekly(page, '再読み込み後も残る条件');
    await expect(page.getByText('テスト応答: 再読み込み後も残る条件', { exact: true })).toBeVisible();

    await page.reload();

    await expect(page.getByText('再読み込み後も残る条件', { exact: true })).toHaveCount(1);
    await expect(page.getByText('テスト応答: 再読み込み後も残る条件', { exact: true })).toHaveCount(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
  });

  test('preview provenance survives reload and remains approvable without rerunning the runtime', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    await createPreview(page, '再読み込み後に保存する条件');

    await page.reload();

    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect(page.getByText('数学のワーク', { exact: true })).toBeVisible();
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);

    await promoteAndApprovePreview(page);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
  });
});
