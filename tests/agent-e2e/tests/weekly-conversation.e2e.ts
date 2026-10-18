import assert from 'node:assert/strict';
import { surfaceOf } from '@e2e-dev/web';
import { expect, test } from 'e2e';
import { weeklyWebEngine } from '../weekly-web-engine';

const vagueRequest = '来週は研究を進めたいけど、内容はまだ決まっていない';

test('smoke: an existing weekly session has a usable accessible composer', async ({ app, screen }) => {
  await app.open('/real-weekly.html');

  const composer = screen.getByRole('textbox', { name: '週間計画にしたいこと', exact: true });
  const send = screen.getByRole('button', { name: '送信' });

  await expect(composer).toBeVisible();
  await expect(send).toBeVisible();
  await composer.fill('来週の予定を立てたい');
  await expect(send).toBeEnabled();
});

test('smoke: weekly planning conversation accepts one user turn', async ({ app, screen }) => {
  await app.open('/real-weekly.html');

  const composer = screen.getByRole('textbox', { name: '週間計画にしたいこと', exact: true });
  await expect(composer).toBeVisible();
  await composer.fill(vagueRequest);
  await screen.getByRole('button', { name: '送信' }).click();

  await expect(screen.getByText(vagueRequest, { exact: true })).toBeVisible();
  await expect(screen.getByText(`テスト応答: ${vagueRequest}`, { exact: true })).toBeVisible();

  // Keep the exact-once controller/reducer and rendered-message guarantees
  // when moving this synthetic 1-turn contract from the Playwright suite.
  const page = surfaceOf(weeklyWebEngine)?.page();
  assert.ok(page, 'The shared TesterArmy web surface must be active');
  const conversation = page.locator('.ai-planning-conversation');
  assert.equal(await conversation.getByText(vagueRequest, { exact: true }).count(), 1);
  assert.equal(await conversation.getByText(`テスト応答: ${vagueRequest}`, { exact: true }).count(), 1);

  const counts = await page.evaluate(() => ({
    execute: (window.__realWeeklyEvents ?? []).filter((event) => event.type === 'real-runtime-execute').length,
    complete: (window.__realWeeklyEvents ?? []).filter((event) => event.type === 'real-runtime-complete').length,
  }));
  assert.deepEqual(counts, { execute: 1, complete: 1 });
});

test('smoke: preview promotion stops at the separate approval gate', async ({ app, screen }) => {
  await app.open('/real-weekly.html?preview=1');

  await screen.getByRole('textbox', { name: '週間計画にしたいこと', exact: true }).fill('来週の予定を立てたい');
  await screen.getByRole('button', { name: '送信' }).click();
  await screen.getByRole('button', { name: '計画プレビューを確認' }).click();

  await expect(screen.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  await screen.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(screen.getByRole('button', { name: 'この内容で保存' })).toBeVisible();

  const page = surfaceOf(weeklyWebEngine)?.page();
  assert.ok(page, 'The shared TesterArmy web surface must be active');
  const boundary = await page.evaluate(() => ({
    mode: window.__realWeeklyState.mode,
    drafts: window.__realWeeklyState.draftBlocks.length,
    pendingApproval: window.__realWeeklyState.pendingApproval,
    saves: (window.__realWeeklyEvents ?? []).filter((event) => event.type === 'real-save-approved-plan').length,
    completions: (window.__realWeeklyEvents ?? []).filter((event) => event.type === 'real-complete-approved-plan').length,
  }));
  assert.deepEqual(boundary, {
    mode: 'awaiting_approval', drafts: 1, pendingApproval: undefined, saves: 0, completions: 0,
  });
});

test('agentic: a vague student request can be submitted through the visible UI', async ({ app, agent, screen }) => {
  await app.open('/real-weekly.html');

  await agent.act(`週間計画の相談欄へ「${vagueRequest}」を入力し、通常の送信操作を一度だけ行ってください。予定の仮登録・承認・保存は行わないでください。`);

  await expect(screen.getByText(`テスト応答: ${vagueRequest}`, { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
});

test('agentic: preview promotion requires a separate approval action', async ({ app, agent, screen }) => {
  await app.open('/?scenario=preview');

  await agent.act('画面のプレビューを一度だけ仮予定に変換してください。「一括承認して保存」ボタンが表示されたら操作を終え、承認・保存のボタンは押さないでください。');

  await expect(screen.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
});
