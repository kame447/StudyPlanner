import { expect, test } from './support/fixed-clock.mjs';

async function seedBookshelf(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('bookshelf-surface-seeded')) return;
    localStorage.setItem('bookshelf-surface-seeded', 'true');
    const today = new Date().toLocaleDateString('sv-SE');
    const tomorrowDate = new Date(`${today}T00:00:00`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = [
      tomorrowDate.getFullYear(),
      String(tomorrowDate.getMonth() + 1).padStart(2, '0'),
      String(tomorrowDate.getDate()).padStart(2, '0'),
    ].join('-');
    const now = new Date().toISOString();
    const user = {
      id: 'bookshelf-e2e-user',
      email: 'bookshelf-e2e@example.com',
      username: 'bookshelf-e2e',
      avatar: '',
      createdAt: now,
    };
    const subject = {
      id: 'bookshelf-e2e-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'bookshelf-e2e-material',
      userId: user.id,
      name: 'アルゴリズム問題集',
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      status: 'active',
      paceEnabled: true,
      progressUnit: 'page',
      totalUnits: 200,
      currentUnit: 80,
      targetDate: tomorrow,
      createdAt: now,
      updatedAt: now,
    };
    const secondMaterial = {
      ...material,
      id: 'bookshelf-e2e-material-2',
      name: 'ネットワーク演習',
      currentUnit: 30,
    };
    const plan = {
      id: 'bookshelf-e2e-plan',
      seriesId: 'bookshelf-e2e-plan',
      userId: user.id,
      title: 'アルゴリズム問題集を進める',
      subject: subject.name,
      date: tomorrow,
      startTime: '19:00',
      endTime: '20:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: 'study',
      memo: '',
      sourceType: 'manual',
      materialId: material.id,
      materialName: material.name,
      createdAt: now,
      updatedAt: now,
    };
    const actual = {
      id: 'bookshelf-e2e-actual',
      userId: user.id,
      planId: null,
      occurrenceDate: today,
      actualStartTime: '18:00',
      actualEndTime: '18:45',
      title: 'アルゴリズム演習',
      subject: subject.name,
      isAlignedToPlan: false,
      note: '動的計画法を復習',
      updatedAt: now,
      materialId: material.id,
      materialName: material.name,
      materialProgressUpdates: [
        {
          materialId: material.id,
          progressUnit: 'page',
          progressUnitLabel: 'ページ',
          fromUnit: 60,
          toUnit: 80,
          deltaUnits: 20,
        },
      ],
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', JSON.stringify([actual]));
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem(
      'studyplanner.studyMaterials.v1',
      JSON.stringify([material, secondMaterial]),
    );
    localStorage.setItem(
      `studyplanner:material-detail:v1:${user.id}:${material.id}`,
      JSON.stringify({
        structureEnabled: true,
        structureVisible: true,
        favorite: true,
        structureItems: [
          { id: 'structure-1', title: '基礎編', startUnit: 0, endUnit: 100 },
          { id: 'structure-2', title: '応用編', startUnit: 100, endUnit: 200 },
        ],
      }),
    );
  });
}

async function openBookshelf(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '教材' })
    .click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
}

test('opens the redesigned bookshelf and material detail from the main navigation', async ({ page }) => {
  await seedBookshelf(page);
  await openBookshelf(page);

  await expect(page.locator('.primary-app-header')).toBeVisible();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await expect(page.locator('.app-view-switcher')).toBeHidden();
  await expect(page.getByRole('heading', { name: '教材', exact: true })).toBeVisible();
  await expect(page.getByText('よく使う教材')).toBeVisible();
  await expect(page.getByText('アルゴリズム問題集').first()).toBeVisible();

  const headerOverflow = await page.locator('.primary-app-header .home-topbar').evaluate((header) => ({
    scrollWidth: header.scrollWidth,
    clientWidth: header.clientWidth,
  }));
  expect(headerOverflow.scrollWidth).toBeLessThanOrEqual(headerOverflow.clientWidth + 1);

  await page.getByText('アルゴリズム問題集').first().click();

  await expect(page.getByRole('heading', { name: '教材の詳細' })).toBeVisible();
  await expect(page.getByText('進捗 40%')).toBeVisible();
  await expect(page.getByText('基礎編', { exact: true })).toBeVisible();
  await expect(page.getByText('45分').first()).toBeVisible();

  await page.getByRole('button', { name: '学習記録', exact: true }).click();
  await expect(page.getByText('60 → 80ページ')).toBeVisible();

  await page
    .locator('.bookshelf-detail-tabs button')
    .filter({ hasText: '予定' })
    .click();
  await expect(page.getByText('アルゴリズム問題集を進める')).toBeVisible();

  await page.getByRole('button', { name: '教材メニューを開く' }).click();
  await expect(page.getByText('目次を編集')).toBeVisible();
  await expect(page.getByText('よく使う教材から外す')).toBeVisible();
});

test.describe('mobile bookshelf containment', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('keeps the bookshelf and bottom navigation inside the viewport', async ({ page }) => {
    await seedBookshelf(page);
    await openBookshelf(page);
    await page.waitForTimeout(300);

    const metrics = await page.evaluate(() => {
      const nav = document.querySelector('.primary-bottom-nav');
      const shell = document.querySelector('.app-shell');
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        navWidth: nav?.getBoundingClientRect().width ?? 0,
        shellWidth: shell?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.navWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.shellWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  });
});

for (const width of [390, 1280]) {
  test(`table of contents editor has usable fields and spacing at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Load the optional pixel stylesheet through its real preference path before comparing surfaces.
    await page.addInitScript(() => localStorage.setItem('study-planner-appearance', 'pixel'));
    await seedBookshelf(page);
    await openBookshelf(page);
    await page.getByText('アルゴリズム問題集').first().click();
    await expect(page.getByText('最近の学習記録')).toBeHidden();
    await expect(page.getByText('今後の予定')).toBeHidden();
    await page.getByRole('button', { name: '教材メニューを開く' }).click();
    await page.getByRole('button', { name: '目次を編集' }).click();
    const editor = page.locator('.bookshelf-structure-editor');
    await expect(editor.getByRole('heading', { name: '目次', exact: true })).toBeVisible();
    await expect(editor.getByLabel('章・節の名前 1', { exact: true })).toHaveValue('基礎編');
    await expect.poll(() => editor.evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
    await page.evaluate(() => { document.documentElement.dataset.appearance = 'standard'; });
    const geometry = await editor.evaluate(element => {
      const row = element.querySelector('.bookshelf-structure-edit-row');
      const inputs = [...row.querySelectorAll('input')];
      const toggle = element.querySelector('.bookshelf-settings-group').getBoundingClientRect();
      const list = element.querySelector('.bookshelf-structure-edit-list').getBoundingClientRect();
      return { widths: inputs.map(input => input.getBoundingClientRect().width), heights: inputs.map(input => input.getBoundingClientRect().height), gap: list.top - toggle.bottom, overflow: element.scrollWidth - element.clientWidth };
    });
    expect(Math.min(...geometry.widths)).toBeGreaterThan(90);
    expect(Math.min(...geometry.heights)).toBeGreaterThanOrEqual(44);
    expect(geometry.gap).toBeGreaterThanOrEqual(16);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`material-contents-${width}.png`), animations: 'disabled' });
    for (const appearance of ['standard', 'pixel']) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(({ appearance, theme }) => {
          document.documentElement.dataset.appearance = appearance;
          document.documentElement.dataset.theme = theme;
        }, { appearance, theme });
        await page.evaluate(() => document.fonts.ready);
        const surface = await editor.evaluate(element => {
          const style = getComputedStyle(element);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          context.fillStyle = style.backgroundColor;
          context.fillRect(0, 0, 1, 1);
          const bounds = element.getBoundingClientRect();
          const toggle = element.querySelector('.bookshelf-settings-group').getBoundingClientRect();
          return {
            alpha: context.getImageData(0, 0, 1, 1).data[3],
            opacity: style.opacity,
            clip: { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(toggle.top - 12), width: 4, height: 4 },
          };
        });
        expect(surface.alpha, `${appearance}/${theme} editor background`).toBe(255);
        expect(surface.opacity).toBe('1');
        const overlay = editor.locator('..');
        const originalBackground = await overlay.evaluate(element => element.style.background);
        try {
          await overlay.evaluate(element => { element.style.background = 'rgb(255, 0, 0)'; });
          await expect(overlay).toHaveCSS('background-color', 'rgb(255, 0, 0)');
          const redBackdrop = await page.screenshot({ clip: surface.clip, animations: 'disabled' });
          await overlay.evaluate(element => { element.style.background = 'rgb(0, 0, 255)'; });
          await expect(overlay).toHaveCSS('background-color', 'rgb(0, 0, 255)');
          const blueBackdrop = await page.screenshot({ clip: surface.clip, animations: 'disabled' });
          expect(redBackdrop.equals(blueBackdrop), `${appearance}/${theme} editor must not blend its backdrop`).toBe(true);
        } finally {
          await overlay.evaluate((element, background) => { element.style.background = background; }, originalBackground);
        }
        await page.screenshot({ path: testInfo.outputPath(`material-contents-${width}-${appearance}-${theme}.png`), animations: 'disabled' });
      }
    }
    await page.evaluate(() => {
      document.documentElement.dataset.appearance = 'standard';
      document.documentElement.dataset.theme = 'light';
    });
    await editor.getByLabel('章・節の名前 1', { exact: true }).fill('一時編集');
    await editor.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await page.getByRole('button', { name: '教材メニューを開く' }).click();
    await page.getByRole('button', { name: '目次を編集' }).click();
    await expect(editor.getByLabel('章・節の名前 1', { exact: true })).toHaveValue('基礎編');
  });
}

for (const width of [390, 1280]) {
  test(`material study status persists separately from archive and progress at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedBookshelf(page); await openBookshelf(page);
    await page.getByText('アルゴリズム問題集', { exact: true }).first().click();
    await page.getByRole('button', { name: '教材メニューを開く' }).click();
    await page.getByRole('button', { name: '教材情報・進捗を編集', exact: true }).click();
    await page.getByRole('combobox', { name: '学習状態', exact: true }).selectOption('completed');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '学習状態', exact: true })).toHaveCount(0);
    await page.reload(); await openBookshelf(page);
    const filter = page.getByRole('group', { name: '学習状態で絞り込み' });
    await filter.getByRole('button', { name: '学習済み', exact: true }).click();
    await expect(page.getByText('アルゴリズム問題集', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ネットワーク演習', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`material-completed-${width}.png`), animations: 'disabled' });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1')).find(material => material.id === 'bookshelf-e2e-material'));
    expect(saved).toMatchObject({ studyStatus: 'completed', status: 'active', currentUnit: 80, totalUnits: 200 });
    await filter.getByRole('button', { name: '学習中', exact: true }).click();
    await expect(page.getByText('アルゴリズム問題集', { exact: true })).toHaveCount(0);
    await expect(page.getByText('ネットワーク演習', { exact: true }).first()).toBeVisible();
  });
}

test('untracked materials omit misleading progress but tracked zero remains visible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBookshelf(page);
  await page.addInitScript(() => {
    const materials = JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1'));
    materials[0].currentUnit = 0;
    materials[1].paceEnabled = false;
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(materials));
  });
  await openBookshelf(page);
  const tracked = page.locator('.bookshelf-featured-card').filter({ hasText: 'アルゴリズム問題集' });
  const untracked = page.locator('.bookshelf-featured-card').filter({ hasText: 'ネットワーク演習' });
  await expect(tracked).toContainText('進捗 0%');
  await expect(untracked.locator('.bookshelf-progress-caption')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('material-progress-disabled.png'), animations: 'disabled' });
  await untracked.click();
  await expect(page.locator('.bookshelf-detail-page')).toBeVisible();
  await expect(page.locator('.bookshelf-detail-page')).not.toContainText('0%');
});

for (const width of [390, 1280]) {
  test(`enabled progress without a total stays hidden on both shelf surfaces at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedBookshelf(page);
    await openBookshelf(page);
    const seededMaterials = await page.evaluate(() => {
      const materials = JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1'));
      const material = materials.find(item => item.id === 'bookshelf-e2e-material');
      material.paceEnabled = true;
      delete material.totalUnits;
      material.studyStatus = 'completed';
      localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(materials));
      return materials;
    });
    await page.reload();
    await openBookshelf(page);
    const subject = page.locator('.bookshelf-subject-toggle').filter({ hasText: '情報科学' });
    if (await subject.getAttribute('aria-expanded') === 'false') await subject.click();
    const featured = page.locator('.bookshelf-featured-card').filter({ hasText: 'アルゴリズム問題集' });
    const row = page.locator('.bookshelf-material-list-row').filter({ hasText: 'アルゴリズム問題集' });
    for (const surface of [featured, row]) {
      await expect(surface).toBeVisible();
      await expect(surface).not.toContainText('%');
      await expect(surface.locator('.bookshelf-inline-progress')).toHaveCount(0);
    }
    await expect(featured.locator('.bookshelf-progress-caption')).toHaveCount(0);
    await expect(row.locator('.bookshelf-material-row-progress')).toHaveCount(0);
    await expect(row).toContainText('学習済み');
    for (const selector of ['.bookshelf-featured-card', '.bookshelf-material-list-row']) {
      const configured = page.locator(selector).filter({ hasText: 'ネットワーク演習' });
      await expect(configured).toContainText('進捗 15%');
      await expect(configured.locator('.bookshelf-inline-progress')).toHaveCount(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`material-progress-without-total-${width}.png`), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1')))).toEqual(seededMaterials);
  });
}

test('photo import discloses its destination and leaves contents unchanged without AI login', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBookshelf(page); await openBookshelf(page);
  await page.getByText('アルゴリズム問題集', { exact: true }).first().click();
  await page.getByRole('button', { name: '教材メニューを開く' }).click();
  await page.getByRole('button', { name: '目次を編集', exact: true }).click();
  const editor = page.locator('.bookshelf-structure-editor');
  const photo = editor.getByRole('region', { name: '目次写真の取込' });
  await expect(photo).toContainText('OpenAIへ送信');
  await expect(photo).toContainText('写真は教材に保存されません');
  const entry = photo.getByRole('button', { name: '目次写真から読み取る', exact: true });
  await expect(entry).toHaveClass(/ghost-button/);
  const entryMetrics = await entry.evaluate(button => {
    const style = getComputedStyle(button);
    return { height: button.getBoundingClientRect().height, minHeight: style.minHeight, padding: style.padding, fontSize: style.fontSize };
  });
  await testInfo.attach('photo-entry-touch-target', { body: JSON.stringify(entryMetrics), contentType: 'application/json' });
  expect(parseFloat(entryMetrics.minHeight)).toBeGreaterThanOrEqual(44);
  expect(entryMetrics.height).toBeGreaterThanOrEqual(44);
  const persisted = await page.evaluate(() => localStorage.getItem('studyplanner:material-detail:v1:bookshelf-e2e-user:bookshelf-e2e-material'));
  await photo.getByLabel('目次写真を選択', { exact: true }).setInputFiles({ name: 'contents.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  await expect(photo.getByRole('alert')).toContainText('ログインとAI接続が必要');
  await expect(editor.getByLabel('章・節の名前 1', { exact: true })).toHaveValue('基礎編');
  await page.screenshot({ path: testInfo.outputPath('material-photo-entry.png'), animations: 'disabled' });
  await editor.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('studyplanner:material-detail:v1:bookshelf-e2e-user:bookshelf-e2e-material'))).toBe(persisted);
});

for (const width of [390, 1280]) {
  test(`synthetic contents extraction supports correction replacement and saved reopen at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const key = 'studyplanner:material-detail:v1:photo-ui-owner:photo-book';
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ structureEnabled: true, structureVisible: true, favorite: false, structureItems: [{ id: 'original', title: '元の目次', startUnit: 1, endUnit: 20 }] }));
    });
    const requests = [];
    await page.route('http://127.0.0.1:4174/planning-attachment', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { items: [
        { level: 1, title: '読取された章', startPage: 1, endPage: 40 },
        { level: 2, title: '最初の節', startPage: 2, endPage: 10 },
        { level: 3, title: '最初の小節', startPage: 3, endPage: 5 },
        { level: 2, title: '次の節', startPage: 11, endPage: 20 },
      ] } }) });
    });
    const open = async () => {
      await page.getByText('目次取込テスト教材', { exact: true }).first().click();
      await page.getByRole('button', { name: '教材メニューを開く' }).click();
      await page.getByRole('button', { name: '目次を編集', exact: true }).click();
    };
    await page.goto('http://127.0.0.1:4174/material-contents-photo.html'); await open();
    const editor = page.locator('.bookshelf-structure-editor');
    const photo = editor.getByRole('region', { name: '目次写真の取込' });
    await photo.getByLabel('目次写真を選択', { exact: true }).setInputFiles({ name: 'contents.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    await expect(photo.getByText('読取結果（未保存）', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(1); expect(requests[0].purpose).toBe('material_contents_photo');
    await photo.getByLabel('見出し', { exact: true }).first().fill('訂正した章');
    page.once('dialog', dialog => dialog.dismiss());
    await photo.getByRole('button', { name: '確認した目次を編集欄へ反映', exact: true }).click();
    await expect(editor.getByLabel('章・節の名前 1', { exact: true })).toHaveValue('元の目次');
    page.once('dialog', dialog => dialog.accept());
    await photo.getByRole('button', { name: '確認した目次を編集欄へ反映', exact: true }).click();
    await expect(editor.getByLabel('章・節の名前 1', { exact: true })).toHaveValue('訂正した章');
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner:material-detail:v1:photo-ui-owner:photo-book')));
    expect(pending.structureItems[0].title).toBe('元の目次');
    await page.screenshot({ path: testInfo.outputPath(`material-photo-reviewed-${width}.png`), animations: 'disabled' });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await page.reload(); await open();
    await expect(editor.getByLabel('章・節の名前 1', { exact: true })).toHaveValue('訂正した章');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner:material-detail:v1:photo-ui-owner:photo-book')));
    expect(saved.structureItems[0]).toMatchObject({ title: '訂正した章', startUnit: 1, endUnit: 40, children: [
      expect.objectContaining({ title: '最初の節', startUnit: 2, endUnit: 10, children: [expect.objectContaining({ title: '最初の小節' })] }),
      expect.objectContaining({ title: '次の節' }),
    ] });
    const subsection = editor.getByLabel('章・節の名前 1-1-1', { exact: true });
    await expect(subsection).toHaveValue('最初の小節');
    await subsection.fill('保存後に修正した小節');
    await expect(subsection).toBeFocused();
    await editor.getByLabel('開始（ページ） 1-1-1', { exact: true }).fill('4');
    await editor.getByLabel('終了（ページ） 1-1-1', { exact: true }).fill('6');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await page.reload(); await open();
    await expect(subsection).toHaveValue('保存後に修正した小節');
    await expect(editor.getByLabel('開始（ページ） 1-1-1', { exact: true })).toHaveValue('4');
    await expect(editor.getByLabel('終了（ページ） 1-1-1', { exact: true })).toHaveValue('6');
    await editor.getByRole('button', { name: '最初の節を削除', exact: true }).click();
    await expect(subsection).toHaveCount(0);
    await expect(editor.getByLabel('章・節の名前 1-1', { exact: true })).toHaveValue('次の節');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await page.reload(); await open();
    const afterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner:material-detail:v1:photo-ui-owner:photo-book')));
    expect(afterDelete.structureItems[0].children).toEqual([expect.objectContaining({ title: '次の節' })]);
  });
}

const deliveryNav = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true });
const persistedShelfInputs = page => page.evaluate(() => Object.fromEntries([
  'studyplanner.session', 'studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1',
  'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1',
].map(key => [key, localStorage.getItem(key)])));
async function prepareShelfDelivery(page) {
  await seedBookshelf(page);
  await page.addInitScript(() => {
    // Control optional warming only; the foreground module and app remain real.
    window.requestIdleCallback = () => 1;
    window.cancelIdleCallback = () => {};
    window.__bookshelfDeliveryDocument = 'retained';
  });
}

test('bookshelf delivery failure retains Home navigation and data on cached reentry', async ({ page }) => {
  await prepareShelfDelivery(page);
  let attempts = 0, documents = 0;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.route('**/BookshelfView-*.js', route => { attempts++; return route.abort('failed'); });
  await page.goto('/');
  await expect(page.locator('.home-main')).toBeVisible();
  const persisted = await persistedShelfInputs(page);
  expect(attempts).toBe(0);
  for (let entry = 0; entry < 2; entry++) {
    await deliveryNav(page, '教材').click();
    await expect(page.getByRole('alert')).toHaveText('教材を読み込めませんでした。');
    await expect(page.locator('.primary-app-header')).toBeVisible();
    await expect(deliveryNav(page, 'ホーム')).toBeVisible();
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toHaveCount(0);
    await deliveryNav(page, 'ホーム').click();
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(deliveryNav(page, 'ホーム')).toHaveAttribute('aria-current', 'page');
  }
  expect(attempts).toBe(1);
  expect(documents).toBe(1);
  expect(await page.evaluate(() => window.__bookshelfDeliveryDocument)).toBe('retained');
  expect(await persistedShelfInputs(page)).toEqual(persisted);
});

test('leaving a pending bookshelf entry prevents late failure from replacing Home', async ({ page }) => {
  await prepareShelfDelivery(page);
  let release, finish;
  const pending = new Promise(resolve => { release = resolve; });
  const rejected = new Promise(resolve => { finish = resolve; });
  let attempts = 0, documents = 0;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.route('**/BookshelfView-*.js', async route => {
    attempts++;
    await pending;
    await route.abort('failed');
    finish();
  });
  try {
    await page.goto('/');
    await expect(page.locator('.home-main')).toBeVisible();
    const persisted = await persistedShelfInputs(page);
    await deliveryNav(page, '教材').click();
    await expect.poll(() => attempts).toBe(1);
    await expect(page.locator('.bookshelf-view')).toHaveCount(0);
    await deliveryNav(page, 'ホーム').click();
    release(); await rejected;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await deliveryNav(page, '教材').click();
    await expect(page.getByRole('alert')).toHaveText('教材を読み込めませんでした。');
    await deliveryNav(page, 'ホーム').click();
    await expect(page.locator('.home-main')).toBeVisible();
    expect(attempts).toBe(1);
    expect(documents).toBe(1);
    expect(await persistedShelfInputs(page)).toEqual(persisted);
  } finally { release(); }
});
