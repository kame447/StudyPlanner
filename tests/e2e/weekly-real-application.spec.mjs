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

function conversation(page) {
  return page.locator('.ai-planning-conversation');
}

async function composer(page) {
  const input = page.locator('.ai-planning-composer textarea');
  await expect(input).toBeVisible();
  return input;
}

async function submitWeekly(page, text) {
  const input = await composer(page);
  await input.fill(text);
  await input.press('Enter');
}

async function waitForRuntimePending(page) {
  await expect.poll(
    () => page.evaluate(() => window.__realWeeklyRuntime.pending()),
  ).toBe(1);
}

async function openPreview(page) {
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  return preview;
}

async function createPreview(page, text = 'previewを作る条件') {
  await submitWeekly(page, text);
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
  const preview = await openPreview(page);
  await expect(preview.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  await expect(preview.getByText('数学のワーク', { exact: true })).toBeVisible();
  return preview;
}

async function promoteAndApprovePreview(page) {
  expect(await events(page, 'real-save-approved-plan')).toHaveLength(0);

  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(preview.getByRole('button', { name: 'この内容で保存' })).toBeVisible();
  expect(await events(page, 'real-save-approved-plan')).toHaveLength(0);

  await preview.getByRole('button', { name: 'この内容で保存' }).click();
  await expect.poll(async () => (await events(page, 'real-save-approved-plan')).length).toBe(1);
  await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);
}

test.describe('real weekly application browser lifecycle through AiPlanningView', () => {
  test('a completed turn crosses the real application/controller/reducer boundary once', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    await submitWeekly(page, '最初の条件');

    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);
    await expect(conversation(page).getByText('最初の条件', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText('テスト応答: 最初の条件', { exact: true })).toHaveCount(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(1);
  });

  test('two sequential turns preserve user-assistant ordering without replay or duplication', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);

    await submitWeekly(page, '1つ目の条件');
    await expect(conversation(page).getByText('テスト応答: 1つ目の条件', { exact: true })).toBeVisible();
    await submitWeekly(page, '2つ目の条件');
    await expect(conversation(page).getByText('テスト応答: 2つ目の条件', { exact: true })).toBeVisible();

    await expect(conversation(page).getByText('1つ目の条件', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText('2つ目の条件', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText('テスト応答: 1つ目の条件', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText('テスト応答: 2つ目の条件', { exact: true })).toHaveCount(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(2);
    expect(await events(page, 'real-runtime-complete')).toHaveLength(2);

    const roles = await page.locator('.ai-planning-message-row').evaluateAll((rows) =>
      rows.map((row) => row.classList.contains('user') ? 'あなた' : 'アプリ'),
    );
    expect(roles).toEqual(['あなた', 'アプリ', 'あなた', 'アプリ']);
  });

  test('canceling an in-flight turn causes the real controller to discard its late runtime result', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
    await submitWeekly(page, 'キャンセルする条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: '処理をキャンセル' }).click();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await expect(conversation(page).getByText('テスト応答: キャンセルする条件', { exact: true })).toHaveCount(0);
    await expect(await composer(page)).toBeEnabled();
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
    await expect(conversation(page).getByText('テスト応答: 採用される条件', { exact: true })).toHaveCount(1);
  });

  test('closing the AI planning surface during a real in-flight turn does not lose the committed result', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
    await submitWeekly(page, '閉じても残る条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: 'テスト用にAI計画を閉じる' }).click();
    await expect(page.getByRole('button', { name: 'AI計画を再度開く' })).toBeVisible();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await page.getByRole('button', { name: 'AI計画を再度開く' }).click();
    await expect(conversation(page).getByText('閉じても残る条件', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText('テスト応答: 閉じても残る条件', { exact: true })).toHaveCount(1);
  });

  test('a preview returned while the AI planning surface is closed survives through real application state', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly&preview=1`);
    await submitWeekly(page, 'previewを作る条件');
    await waitForRuntimePending(page);

    await page.getByRole('button', { name: 'テスト用にAI計画を閉じる' }).click();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    await page.getByRole('button', { name: 'AI計画を再度開く' }).click();
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
    const preview = await openPreview(page);
    await expect(preview.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect(preview.getByText('数学のワーク', { exact: true })).toBeVisible();
  });

  test('clearing conversation history preserves an already-created preview', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    const preview = await createPreview(page, '履歴だけ消す条件');

    const cleared = await page.evaluate(() => window.__realWeeklyActions.clearConversation());
    expect(cleared).toBe(true);

    await expect(conversation(page).getByText('履歴だけ消す条件', { exact: true })).toHaveCount(0);
    await expect(conversation(page).getByText('テスト応答: 履歴だけ消す条件', { exact: true })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect(preview.getByText('数学のワーク', { exact: true })).toBeVisible();
  });

  test('weekly reset starts a clean active chat while preserving history across reload', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    const preview = await createPreview(page, 'リセットする条件');
    await preview.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);

    await page.getByRole('button', { name: 'チャット一覧を開く' }).click();
    await page.getByRole('button', { name: /週間計画をリセット/ }).click();
    const confirmation = page.getByRole('dialog', { name: '今週の計画をリセットしますか？' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'リセット' }).click();

    await expect(conversation(page).getByText('リセットする条件', { exact: true })).toHaveCount(0);
    await expect(conversation(page).getByText('テスト応答: リセットする条件', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
    await expect(page.locator('.ai-planning-starters')).toBeVisible();

    await page.reload();

    await expect(conversation(page).getByText('リセットする条件', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);

    await page.getByRole('button', { name: 'チャット一覧を開く' }).click();
    await expect(page.locator('.ai-chat-row')).toHaveCount(2);
    await expect(page.locator('.ai-chat-delete')).toHaveCount(2);
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
    await expect(conversation(page).getByText('テスト応答: 再読み込み後も残る条件', { exact: true })).toBeVisible();

    await page.reload();

    await expect(conversation(page).getByText('再読み込み後も残る条件', { exact: true })).toHaveCount(1);
    await expect(conversation(page).getByText('テスト応答: 再読み込み後も残る条件', { exact: true })).toHaveCount(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
  });

  test('preview provenance survives reload and remains approvable without rerunning the runtime', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1`);
    await createPreview(page, '再読み込み後に保存する条件');

    await page.reload();

    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
    const preview = await openPreview(page);
    await expect(preview.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
    await expect(preview.getByText('数学のワーク', { exact: true })).toBeVisible();
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);

    await promoteAndApprovePreview(page);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
  });
});
