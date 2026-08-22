export const REGRESSION_DATE = '2026-08-19';
export const REGRESSION_TIME = new Date('2026-08-19T12:00:00+09:00');

export async function seedRegressionUser(page, { theme = 'light', palette = 'ocean' } = {}) {
  await page.clock.setFixedTime(REGRESSION_TIME);
  await page.addInitScript(({ theme: selectedTheme, palette: selectedPalette }) => {
    const now = '2026-08-19T03:00:00.000Z';
    const user = {
      id: 'ui-regression-user',
      email: 'ui-regression@example.com',
      username: 'ui-regression-user',
      avatar: '',
      createdAt: now,
    };
    const subject = {
      id: 'ui-regression-subject',
      userId: user.id,
      name: '情報科学',
      color: '#2f6fc2',
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'ui-regression-material',
      userId: user.id,
      name: '基本情報技術者テキスト',
      subjectId: subject.id,
      subjectName: subject.name,
      color: subject.color,
      status: 'active',
      progressUnit: 'page',
      totalUnits: 500,
      currentUnit: 120,
      createdAt: now,
      updatedAt: now,
    };
    const plans = [
      {
        id: 'ui-regression-plan-class',
        seriesId: 'ui-regression-plan-class',
        userId: user.id,
        title: '情報資源総論',
        subject: subject.name,
        type: 'study',
        sourceType: 'timetable',
        date: '2026-08-19',
        startTime: '10:20',
        endTime: '11:50',
        memo: '',
        recurrence: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ui-regression-plan-study',
        seriesId: 'ui-regression-plan-study',
        userId: user.id,
        title: 'アルゴリズム演習',
        subject: subject.name,
        type: 'study',
        sourceType: 'manual',
        date: '2026-08-19',
        startTime: '13:30',
        endTime: '15:00',
        memo: '',
        recurrence: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ui-regression-plan-other',
        seriesId: 'ui-regression-plan-other',
        userId: user.id,
        title: '買い物',
        subject: '',
        type: 'other',
        sourceType: 'manual',
        date: '2026-08-19',
        startTime: '18:00',
        endTime: '19:00',
        memo: '',
        recurrence: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(plans));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
    localStorage.setItem('study-planner-theme-mode', selectedTheme);
    localStorage.setItem('study-planner-theme-palette', selectedPalette);
  }, { theme, palette });
}

export async function clickPrimaryNav(page, label) {
  const nav = page.locator('.home-bottom-nav:visible').last();
  await nav.waitFor({ state: 'visible' });
  await nav.locator('button').filter({ hasText: label }).click();
}

export async function readDocumentBounds(page) {
  return page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
}

export async function installVisualGuards(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
}

function rectDistance(a, b) {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );
}

export async function waitForVisualReady(page, selector) {
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete),
    null,
    { timeout: 5_000 },
  );

  let previous = null;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await target.boundingBox();
    if (current && previous && rectDistance(current, previous) <= 0.25) {
      stableSamples += 1;
      if (stableSamples >= 2) {
        return;
      }
    } else {
      stableSamples = 0;
    }
    previous = current;
    await page.waitForTimeout(100);
  }

  throw new Error(`visual target did not settle: ${selector}`);
}
