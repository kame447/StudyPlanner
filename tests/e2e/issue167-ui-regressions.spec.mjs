import { expect, test } from '@playwright/test';

function seedIssue167State(page) {
  return page.addInitScript(() => {
    const now = new Date();
    const createdAt = now.toISOString();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const user = {
      id: 'issue167-user',
      email: 'issue167@example.com',
      username: 'issue167',
      avatar: '',
      createdAt,
    };
    const subject = {
      id: 'issue167-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt,
      updatedAt: createdAt,
    };
    const material = {
      id: 'issue167-material',
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
      createdAt,
      updatedAt: createdAt,
    };
    const secondMaterial = {
      ...material,
      id: 'issue167-material-2',
      name: 'ネットワーク演習',
      currentUnit: 30,
    };
    const plan = {
      id: 'issue167-plan',
      seriesId: 'issue167-plan',
      userId: user.id,
      title: '回帰確認用の学習',
      subject: subject.name,
      type: 'study',
      date: today,
      startTime: '19:00',
      endTime: '20:30',
      memo: '',
      recurrence: null,
      createdAt,
      updatedAt: createdAt,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem(
      'studyplanner.studyMaterials.v1',
      JSON.stringify([material, secondMaterial]),
    );
  });
}

function relativeLuminance([red, green, blue]) {
  const channels = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function parseRgb(color) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Unsupported color: ${color}`);
  }
  return channels;
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(parseRgb(foreground));
  const backgroundLuminance = relativeLuminance(parseRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function openBookshelf(page) {
  await page
    .locator('.primary-bottom-nav button')
    .filter({ hasText: '教材' })
    .click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
}

test.describe('issue 167 UI regressions', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps each home date value inside one continuous four-cell plaque', async ({ page }) => {
    await seedIssue167State(page);
    await page.goto('/');
    await expect(page.locator('.home-date-paper')).toBeVisible();

    const dateState = await page.locator('.home-date-paper').evaluate((paper) => {
      const paperBox = paper.getBoundingClientRect();
      const segments = [...paper.querySelectorAll('.home-date-segment')];
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        texts: segments.map((segment) => segment.textContent?.trim() ?? ''),
        contained: segments.every((segment) => {
          const segmentBox = segment.getBoundingClientRect();
          const value = segment.querySelector('.home-date-value');
          if (!(value instanceof HTMLElement)) return false;
          const valueBox = value.getBoundingClientRect();
          return (
            segmentBox.left >= paperBox.left - 0.75 &&
            segmentBox.right <= paperBox.right + 0.75 &&
            valueBox.left >= segmentBox.left - 0.75 &&
            valueBox.right <= segmentBox.right + 0.75
          );
        }),
      };
    });

    expect(dateState.texts).toHaveLength(4);
    expect(dateState.texts[0]).toMatch(/^\d{4}$/);
    expect(dateState.texts[1]).toMatch(/^\d{1,2}$/);
    expect(dateState.texts[2]).toMatch(/^\d{1,2}$/);
    expect(dateState.texts[3]).toMatch(/^[日月火水木金土]$/);
    expect(dateState.contained).toBe(true);
    expect(dateState.pageWidth).toBeLessThanOrEqual(dateState.viewportWidth + 1);
  });

  test('preserves bookshelf row keyboard actions without nested interactive roles', async ({ page }) => {
    await seedIssue167State(page);
    await page.goto('/');
    await openBookshelf(page);

    await expect(
      page.locator('.bookshelf-material-list-row[role="button"], .bookshelf-recent-row[role="button"]'),
    ).toHaveCount(0);

    const materialRow = page.locator('.bookshelf-material-list-row').first();
    const openButton = materialRow.locator(':scope > .bookshelf-row-open-button');
    const menuButton = materialRow.locator(':scope > .bookshelf-row-menu-button');
    await expect(openButton).toHaveCount(1);
    await expect(menuButton).toHaveCount(1);

    await menuButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('教材内構造を編集')).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();

    await openButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '教材の詳細' })).toBeVisible();
  });

  test('keeps the reproduced Home and dark Bookshelf color pairs above AA contrast', async ({ page }) => {
    await seedIssue167State(page);
    await page.goto('/');

    const homeColors = await page.evaluate(() => {
      const summary = document.querySelector('.weekly-progress-summary');
      const negative = document.querySelector('.weekly-progress-negative');
      if (!(summary instanceof HTMLElement) || !(negative instanceof HTMLElement)) {
        throw new Error('weekly progress contrast targets are missing');
      }
      return {
        summary: getComputedStyle(summary).color,
        negative: getComputedStyle(negative).color,
      };
    });

    expect(contrastRatio(homeColors.summary, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(homeColors.negative, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(4.5);

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.setProperty('--accent', '#6fb2ff');
    });
    await openBookshelf(page);

    const fabColors = await page.locator('.bookshelf-add-material-fab').evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        foreground: style.color,
        background: style.backgroundColor,
      };
    });

    expect(contrastRatio(fabColors.foreground, fabColors.background)).toBeGreaterThanOrEqual(4.5);
  });
});
