import { expect, test } from './support/fixed-clock.mjs';

async function start(page) {
  const documents = [];
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4174/admin-entry.html');
  await expect(page.getByRole('button', { name: 'マイページを開く', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__adminEntryDocument = 'retained'; });
  return async () => {
    expect(documents).toHaveLength(1);
    expect(await page.evaluate(() => window.__adminEntryDocument)).toBe('retained');
    expect(await page.evaluate(() => window.__adminEntryAccess.snapshot().signOutCalls)).toBe(0);
  };
}
async function openProfile(page) {
  await page.getByRole('button', { name: 'マイページを開く', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'マイページ', exact: true })).toBeVisible();
}
async function openAdmin(page) {
  await openProfile(page);
  await page.getByRole('button', { name: '管理者画面', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
}

test('normal entry, return, Back and Forward preserve the document and session', async ({ page }, info) => {
  const sameDocument = await start(page);
  await openAdmin(page);
  await expect(page).toHaveURL(/\/admin\/users$/);
  await sameDocument();
  await info.attach('admin-entry', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByRole('link', { name: '通常画面へ戻る', exact: true }).click();
  await expect(page.getByRole('button', { name: 'マイページを開く', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('button', { name: 'マイページを開く', exact: true })).toBeVisible();
  await openProfile(page);
  await expect(page.getByPlaceholder('未入力ならメールアドレスを使います')).toHaveValue('Entry fixture');
  await sameDocument();
});

test('real checkpoint failure asks before entry, preserves cancelled drafts and permits confirmed entry', async ({ page }) => {
  const sameDocument = await start(page);
  await page.getByRole('button', { name: 'AI計画', exact: true }).click();
  const composer = page.locator('textarea');
  await composer.fill('Keep this unsent draft');
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key.includes('.chat.v1.')) throw new Error('Synthetic checkpoint write failure');
      return write.call(this, key, value);
    };
  });
  const drawer = page.getByRole('button', { name: 'チャット一覧を開く', exact: true });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole('button', { name: '新しいチャット', exact: true }).click();
  await expect(page.getByRole('button', { name: 'チャットの保存を再試行', exact: true })).toBeVisible();
  const closeDrawer = page.getByRole('button', { name: 'チャット一覧を閉じる', exact: true });
  if (await closeDrawer.isVisible()) await closeDrawer.click();
  await openProfile(page);
  await page.getByPlaceholder('未入力ならメールアドレスを使います').fill('Keep profile draft');
  const cancelled = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe('confirm'); await dialog.dismiss();
  });
  await page.getByRole('button', { name: '管理者画面', exact: true }).click(); await cancelled;
  await expect(page.getByRole('heading', { name: 'マイページ', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('未入力ならメールアドレスを使います')).toHaveValue('Keep profile draft');
  await expect(composer).toHaveValue('Keep this unsent draft');
  await sameDocument();
  const confirmed = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe('confirm'); await dialog.accept();
  });
  await page.getByRole('button', { name: '管理者画面', exact: true }).click(); await confirmed;
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await sameDocument();
});

test('access revocation and sign-out still protect Admin and leave the return action available', async ({ page }) => {
  const sameDocument = await start(page);
  await openAdmin(page);
  await page.evaluate(() => window.__adminEntryAccess.setAccess(false));
  await expect(page.getByRole('alert')).toContainText('アクセス権限がありません');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__adminEntryAccess.signOut());
  await expect(page.getByRole('alert')).toContainText('ログインが必要です');
  await page.getByRole('link', { name: '通常画面へ戻る', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
  await sameDocument();
});

test('Back remains available while the lazy Admin module is pending and a late failure cannot replace Home', async ({ page }) => {
  const sameDocument = await start(page);
  let fail;
  const gate = new Promise(resolve => { fail = resolve; });
  let requested = false;
  await page.route(/\/AdminApp\.tsx(?:\?.*)?$/, async route => {
    requested = true; await gate; await route.abort('failed');
  });
  try {
    await openProfile(page);
    await page.getByRole('button', { name: '管理者画面', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole('status')).toHaveText('管理者画面を開いています');
    await page.goBack();
    await expect(page.getByRole('button', { name: 'マイページを開く', exact: true })).toBeVisible();
    const rejected = page.waitForEvent('requestfailed', request => /\/AdminApp\.tsx(?:\?.*)?$/.test(request.url()));
    fail(); await rejected;
    await openProfile(page);
    await expect(page.getByPlaceholder('未入力ならメールアドレスを使います')).toHaveValue('Entry fixture');
    await sameDocument();
  } finally { fail(); }
});
