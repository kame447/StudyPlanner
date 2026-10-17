import { expect, test } from 'e2e';

const vagueRequest = '来週は研究を進めたいけど、内容はまだ決まっていない';

test('smoke: weekly planning conversation accepts one user turn', async ({ app, screen }) => {
  await app.open('/real-weekly.html');

  const composer = screen.getByRole('textbox');
  await expect(composer).toBeVisible();
  await composer.fill(vagueRequest);
  await screen.getByRole('button', { name: '送信' }).click();

  await expect(screen.getByText(vagueRequest, { exact: true })).toBeVisible();
  await expect(screen.getByText(`テスト応答: ${vagueRequest}`, { exact: true })).toBeVisible();
});

test('smoke: preview promotion stops at the separate approval gate', async ({ app, screen }) => {
  await app.open('/?scenario=preview');

  await expect(screen.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  await screen.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(screen.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
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
