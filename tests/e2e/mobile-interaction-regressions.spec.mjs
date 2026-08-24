import { expect, test } from '@playwright/test';

function isoToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

async function seedBaseUser(page, extend = {}) {
  await page.addInitScript(({ today, extra }) => {
    const now = new Date().toISOString();
    const user = {
      id: 'mobile-regression-user',
      email: 'mobile-regression@example.com',
      username: 'mobile-regression',
      avatar: '',
      createdAt: now,
    };

    const plans = (extra.plans ?? []).map((plan, index) => ({
      id: plan.id ?? `mobile-regression-plan-${index + 1}`,
      seriesId: plan.seriesId ?? plan.id ?? `mobile-regression-plan-${index + 1}`,
      userId: user.id,
      title: plan.title,
      subject: plan.subject ?? '',
      type: plan.type ?? 'study',
      date: plan.date ?? today,
      startTime: plan.startTime,
      endTime: plan.endTime,
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      memo: '',
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
      ...plan,
      userId: user.id,
    }));

    const subjects = (extra.subjects ?? []).map((subject, index) => ({
      id: subject.id ?? `mobile-regression-subject-${index + 1}`,
      userId: user.id,
      name: subject.name,
      color: subject.color ?? '#2f6fc2',
      createdAt: now,
      updatedAt: now,
      ...subject,
      userId: user.id,
    }));

    const materials = (extra.materials ?? []).map((material, index) => ({
      id: material.id ?? `mobile-regression-material-${index + 1}`,
      userId: user.id,
      name: material.name,
      subjectId: material.subjectId,
      subjectName: material.subjectName,
      color: material.color ?? '#2f6fc2',
      status: 'active',
      paceEnabled: true,
      progressUnit: 'page',
      totalUnits: 100,
      currentUnit: 25,
      createdAt: now,
      updatedAt: now,
      ...material,
      userId: user.id,
    }));

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(plans));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify(subjects));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(materials));
  }, { today: isoToday(), extra: extend });
}

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
}

async function openBookshelf(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '教材' }).click();
  await expect(page.locator('.bookshelf-view')).toBeVisible();
}

test.describe('mobile interaction regressions', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('record editor body stays below the sheet header and close action', async ({ page }) => {
    await seedBaseUser(page, {
      plans: [
        {
          id: 'record-sheet-plan',
          title: '研究室ミーティング',
          subject: '研究',
          type: 'other',
          startTime: '09:00',
          endTime: '10:00',
        },
      ],
    });
    await openSchedule(page);

    const dayTab = page.getByRole('tab', { name: '日', exact: true });
    if ((await dayTab.getAttribute('aria-selected')) !== 'true') {
      await dayTab.click();
    }

    const planBlock = page.locator('.timeline-plan-block').filter({ hasText: '研究室ミーティング' });
    await expect(planBlock).toBeVisible();
    await planBlock.click();
    await page.locator('.schedule-action-item').filter({ hasText: '記録を保存' }).click();

    const sheet = page.locator('.schedule-record-sheet');
    const header = sheet.locator('.daily-detail-modal-header');
    const close = header.getByRole('button', { name: '閉じる' });
    const body = sheet.locator('.daily-detail-modal-body');

    await expect(sheet).toBeVisible();
    await expect(close).toBeVisible();
    await expect(body).toBeVisible();

    const geometry = await page.evaluate(() => {
      const header = document.querySelector('.schedule-record-sheet .daily-detail-modal-header');
      const close = document.querySelector('.schedule-record-sheet .schedule-action-close');
      const body = document.querySelector('.schedule-record-sheet .daily-detail-modal-body');
      if (!(header instanceof HTMLElement) || !(close instanceof HTMLElement) || !(body instanceof HTMLElement)) {
        return null;
      }
      const headerBox = header.getBoundingClientRect();
      const closeBox = close.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        headerBottom: headerBox.bottom,
        bodyTop: bodyBox.top,
        overlapsClose:
          closeBox.left < bodyBox.right &&
          closeBox.right > bodyBox.left &&
          closeBox.top < bodyBox.bottom &&
          closeBox.bottom > bodyBox.top,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.bodyTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
    expect(geometry.overlapsClose).toBe(false);
  });

  test('bookshelf subjects close independently and multiple subjects stay open', async ({ page }) => {
    await seedBaseUser(page, {
      subjects: [
        { id: 'subject-info', name: '情報科学', color: '#2f6fc2' },
        { id: 'subject-research', name: '研究', color: '#2f9a74' },
      ],
      materials: [
        {
          id: 'material-info',
          name: 'アルゴリズム問題集',
          subjectId: 'subject-info',
          subjectName: '情報科学',
          color: '#2f6fc2',
        },
        {
          id: 'material-research',
          name: '卒業研究ノート',
          subjectId: 'subject-research',
          subjectName: '研究',
          color: '#2f9a74',
        },
      ],
    });
    await openBookshelf(page);

    const information = page.locator('.bookshelf-subject-toggle').filter({ hasText: '情報科学' });
    const research = page.locator('.bookshelf-subject-toggle').filter({ hasText: '研究' });

    if ((await information.getAttribute('aria-expanded')) !== 'true') {
      await information.click();
    }
    await research.click();

    await expect(information).toHaveAttribute('aria-expanded', 'true');
    await expect(research).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: 'アルゴリズム問題集' })).toBeVisible();
    await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: '卒業研究ノート' })).toBeVisible();

    await information.click();
    await expect(information).toHaveAttribute('aria-expanded', 'false');
    await expect(research).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: 'アルゴリズム問題集' })).toHaveCount(0);
    await expect(page.locator('.bookshelf-material-list-row').filter({ hasText: '卒業研究ノート' })).toBeVisible();
  });

  test('AI planning does not force focus into the composer on entry', async ({ page }) => {
    await seedBaseUser(page);
    await page.goto('/');
    await expect(page.locator('.primary-bottom-nav')).toBeVisible();
    await page.locator('.primary-bottom-nav button').first().click();

    const composer = page.locator('.ai-planning-composer textarea');
    await expect(composer).toBeVisible();
    await expect(composer).not.toBeFocused();
  });

  test('today schedule connector reaches every adjacent row boundary in dark mode', async ({ page }) => {
    await seedBaseUser(page, {
      plans: [
        { title: '青チャート', subject: '数学', startTime: '08:30', endTime: '09:30' },
        { title: 'コンピュータネットワーク', subject: '情報', startTime: '10:00', endTime: '11:00' },
        { title: 'DUO 3.0', subject: '英語', startTime: '13:30', endTime: '14:30' },
        { title: '卒研 論文整理', subject: '研究', startTime: '20:00', endTime: '21:00' },
      ],
    });
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });

    const rows = page.locator('.home-schedule-row');
    await expect(rows).toHaveCount(4);

    const states = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const rowBox = element.getBoundingClientRect();
        const marker = element.querySelector('.home-time-dot');
        const markerBox = marker?.getBoundingClientRect();
        const connector = getComputedStyle(element, '::before');
        const legacyTail = marker ? getComputedStyle(marker, '::after') : null;
        const top = Number.parseFloat(connector.top);
        const bottom = Number.parseFloat(connector.bottom);
        const left = Number.parseFloat(connector.left);
        return {
          top,
          bottom,
          connectorX: rowBox.left + left,
          markerCenterX: markerBox ? markerBox.left + markerBox.width / 2 : null,
          borderStyle: connector.borderLeftStyle,
          borderColor: connector.borderLeftColor,
          legacyContent: legacyTail?.content ?? null,
        };
      }),
    );

    expect(states[0].bottom).toBeLessThanOrEqual(1);
    expect(states[1].top).toBeLessThanOrEqual(1);
    expect(states[1].bottom).toBeLessThanOrEqual(1);
    expect(states[2].top).toBeLessThanOrEqual(1);
    expect(states[2].bottom).toBeLessThanOrEqual(1);
    expect(states[3].top).toBeLessThanOrEqual(1);

    for (const state of states) {
      expect(state.connectorX).toBeCloseTo(state.markerCenterX, 0);
      expect(state.borderStyle).toBe('dashed');
      expect(state.borderColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(['none', 'normal']).toContain(state.legacyContent);
    }
  });
});
