import { expect, test as base } from './support/startup-ready.mjs';
import { waitForVisualReady } from './support/ui-regression.mjs';

// Cold page creation has its own setup budget. Behavior retains Playwright's
// normal 30-second deadline, as does the existing settings-page regression.
const test = base.extend({
  atmospherePage: [async ({ context }, use) => {
    await use(await context.newPage());
  }, { timeout: 30_000 }],
});

const PIXEL_STYLES = ['pixel', 'pixel-cat', 'pixel-turtle'];
const CLASS_TITLE = '夜の情報資源総論';

async function seedScene(page, { style = 'pixel', kind = 'class', instant }) {
  await page.addInitScript(({ style, kind, instant, title }) => {
    const local = new Date(instant);
    const today = [local.getFullYear(), String(local.getMonth() + 1).padStart(2, '0'), String(local.getDate()).padStart(2, '0')].join('-');
    const user = { id: 'atmosphere-user', email: 'atmosphere@example.test', username: '空のテスト', avatar: '', createdAt: instant };
    const plan = {
      id: 'atmosphere-plan', seriesId: 'atmosphere-plan', userId: user.id,
      title, subject: '情報科学', type: 'study', sourceType: kind === 'class' ? 'timetable' : 'manual',
      date: today, startTime: '22:30', endTime: '23:15', memo: '', recurrence: null,
      createdAt: instant, updatedAt: instant,
    };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('study-planner-home-scene-style', style);
    localStorage.setItem('study-planner-home-scene-motion', 'false');
    localStorage.setItem('study-planner-theme-mode', 'light');
  }, { style, kind, instant, title: kind === 'class' ? CLASS_TITLE : '夜の復習' });
}

async function expectActivity(page, scene, kind = 'class') {
  await expect(scene).toHaveAttribute('data-scene-kind', kind);
  await expect(page.locator('.home-next-card h1')).toHaveText(kind === 'class' ? CLASS_TITLE : '夜の復習');
}

async function expectStill(scene) {
  await expect.poll(() => scene.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
}

async function skyFill(scene) {
  return scene.locator('[data-scene-sky] > g > path').first().evaluate(element => getComputedStyle(element).fill);
}

test.describe('local-time pixel atmosphere', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  for (const style of PIXEL_STYLES) {
    test(`${style}: flowing sunset/night transitions remain still and theme independent on mobile`, async ({ atmospherePage: page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      // Install a flowing clock before navigation. setFixedTime near a minute
      // boundary would freeze Date while timers run and cannot test this flow.
      const start = '2026-08-28T16:50:00+09:00';
      await page.clock.install({ time: new Date(start) });
      await seedScene(page, { style, instant: new Date(start).toISOString() });
      await page.goto('/');
      const scene = page.locator('.home-next-card .home-study-scene');
      await expectActivity(page, scene);
      await expect(scene).toHaveAttribute('data-scene-style', style);
      await waitForVisualReady(page, '.home-next-card');
      await page.clock.pauseAt(new Date('2026-08-28T16:59:59+09:00'));
      await expect(scene).toHaveAttribute('data-scene-period', 'day');
      await page.clock.runFor(1000);
      await expect(scene).toHaveAttribute('data-scene-period', 'sunset');
      await expect(scene).toHaveAttribute('data-scene-motion', 'off');
      await expectStill(scene);
      await expectActivity(page, scene);
      const sunsetFill = await skyFill(scene);
      await testInfo.attach(`${style}-class-sunset-mobile`, {
        body: await page.locator('.home-next-card').screenshot({ animations: 'disabled' }), contentType: 'image/png',
      });

      // Resume normal timers for settings navigation and layout stabilization.
      await page.clock.resume();
      await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
      const settings = page.locator('.app-settings-page');
      await settings.getByRole('button', { name: 'ダーク', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(scene).toHaveAttribute('data-scene-period', 'sunset');
      expect(await skyFill(scene)).toBe(sunsetFill);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす', exact: true }).check();
      await settings.getByRole('button', { name: '戻る', exact: true }).click();
      await expect(scene).toHaveAttribute('data-scene-motion', 'on');
      await expectStill(scene);
      await waitForVisualReady(page, '.home-next-card');

      await page.clock.pauseAt(new Date('2026-08-28T18:59:59+09:00'));
      await expect(scene).toHaveAttribute('data-scene-period', 'sunset');
      await page.clock.runFor(1000);
      await expect(scene).toHaveAttribute('data-scene-period', 'night');
      expect(await skyFill(scene)).not.toBe(sunsetFill);
      await expectStill(scene);
      await expectActivity(page, scene);
      const moon = scene.locator('[data-moon-stage]');
      await expect(moon).toHaveAttribute('data-moon-stage', '4');
      await expect(moon.locator('[data-moon-light]')).not.toHaveAttribute('d', '');
      const moonBox = await moon.boundingBox();
      const sceneBox = await scene.boundingBox();
      expect(moonBox).not.toBeNull();
      expect(sceneBox).not.toBeNull();
      expect(moonBox.width).toBeGreaterThanOrEqual(4);
      expect(moonBox.height).toBeGreaterThanOrEqual(4);
      expect(moonBox.x).toBeGreaterThanOrEqual(sceneBox.x);
      expect(moonBox.x + moonBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + .5);
      await testInfo.attach(`${style}-class-night-mobile`, {
        body: await page.locator('.home-next-card').screenshot({ animations: 'disabled' }), contentType: 'image/png',
      });
    });
  }
});

// Independent phase anchor: USNO's full moon is 2026-08-28 04:18 UT.
// https://aa.usno.navy.mil/calculated/moon/phases?year=2026
const FULL_MOON_INSTANT = '2026-08-28T04:18:00Z';
for (const { zone, localHour } of [{ zone: 'UTC', localHour: 4 }, { zone: 'America/New_York', localHour: 0 }]) {
  test.describe(`absolute moon instant in ${zone}`, () => {
    test.use({ timezoneId: zone });
    test('shows the same full moon at the exact instant despite a different local hour', async ({ atmospherePage: page }) => {
      const start = new Date(Date.parse(FULL_MOON_INSTANT) - 120_000);
      await page.clock.install({ time: start });
      await seedScene(page, { kind: 'study', instant: start.toISOString() });
      await page.goto('/');
      const scene = page.locator('.home-next-card .home-study-scene');
      await expectActivity(page, scene, 'study');
      await waitForVisualReady(page, '.home-next-card');
      await page.clock.pauseAt(new Date(FULL_MOON_INSTANT));
      expect(await page.evaluate(() => ({ instant: Date.now(), hour: new Date().getHours() }))).toEqual({
        instant: Date.parse(FULL_MOON_INSTANT), hour: localHour,
      });
      await expect(scene).toHaveAttribute('data-scene-period', 'night');
      const moon = scene.locator('[data-moon-stage]');
      await expect(moon).toHaveAttribute('data-moon-stage', '4');
      const paths = await moon.locator('path').evaluateAll(elements => elements.map(element => element.getAttribute('d')));
      expect(paths).toHaveLength(2);
      expect(paths[0].length).toBeGreaterThan(0);
      expect(paths[1]).toBe(paths[0]);
      await expectStill(scene);
    });
  });
}
