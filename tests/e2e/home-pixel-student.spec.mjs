import { expect, test } from './support/startup-ready.mjs';

async function seed(page, { now, sourceType = 'timetable', motion = true }) {
  await page.addInitScript(({ now, sourceType, motion }) => {
    if (localStorage.getItem('pixel-student-seeded')) return;
    const user = { id: 'pixel-student', email: 'pixel-student@example.test', username: 'Pixel Student', avatar: '', createdAt: now };
    const plan = (id, startTime, endTime) => ({
      id, seriesId: id, userId: user.id, title: id, subject: 'Math', type: 'study', sourceType,
      date: '2026-10-07', startTime, endTime, repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], memo: '', createdAt: now, updatedAt: now,
    });
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan('first', '10:20', '10:21'), plan('later', '10:22', '10:23')]));
    for (const key of ['studyplanner.actuals', 'studyplanner.monthEvents', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('study-planner-home-scene-style', 'pixel');
    localStorage.setItem('study-planner-home-scene-motion', String(motion));
    localStorage.setItem('pixel-student-seeded', '1');
  }, { now, sourceType, motion });
}
const scene = page => page.locator('.home-next-card .home-study-scene');
const student = page => scene(page).locator('[data-pixel-student]');
const data = page => page.evaluate(() => ['studyplanner.scheduleEvents.v1', 'studyplanner.actuals']
  .map(key => localStorage.getItem(key)));

for (const { zone, offset } of [{ zone: 'Asia/Tokyo', offset: '+09:00' }, { zone: 'America/New_York', offset: '-04:00' }]) {
  for (const width of [390, 1280]) test.describe(`scheduled pixel student ${zone} ${width}px`, () => {
    test.use({ timezoneId: zone, viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
    const instant = time => new Date(`2026-10-07T${time}${offset}`);

    for (const sourceType of ['timetable', 'manual']) test(`${sourceType}: enters once at start, sits, and follows next plan`, async ({ page }, testInfo) => {
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      await page.clock.install({ time: instant('10:19:00') });
      // Mount with a paused clock so scheduler performance reads cannot move
      // timer registration a millisecond past the exact minute we assert.
      // The production minute timer still drives the entrance below.
      await page.clock.pauseAt(instant('10:19:59'));
      await seed(page, { now: instant('10:19:00').toISOString(), sourceType });
      await page.goto('/');
      await expect(scene(page)).toBeVisible();
      await expect(scene(page)).toHaveAttribute('data-scene-kind', sourceType === 'timetable' ? 'class' : 'study');
      expect(await page.evaluate(() => Date.now())).toBe(instant('10:19:59').getTime());
      await expect(student(page)).toHaveCount(0);
      const originalData = await data(page);
      await page.clock.runFor(1000);
      await expect(student(page)).toHaveAttribute('data-pixel-student', 'entering');
      const walking = student(page).locator('.home-pixel-student-walking');
      await expect(walking).toHaveCSS('animation-name', 'home-pixel-student-enter');
      const frames = await walking.evaluate(element => {
        const animation = element.getAnimations()[0];
        animation.pause();
        return [0, .5, .85, .95].map(progress => {
          animation.currentTime = 2800 * progress;
          const style = getComputedStyle(element);
          return { x: new DOMMatrixReadOnly(style.transform).m41, opacity: Number(style.opacity) };
        });
      });
      expect(frames[0].x).toBeGreaterThan(frames[1].x);
      expect(frames[1].x).toBeGreaterThan(frames[2].x);
      expect(frames[2].x).toBe(0); expect(frames[3].opacity).toBe(0);
      await page.clock.runFor(2800);
      await expect(student(page)).toHaveAttribute('data-pixel-student', 'studying');
      await expect(walking).toHaveCount(0);
      await expect(student(page).locator('.home-pixel-student-writing')).toHaveCSS('animation-name', 'home-pixel-student-write');
      const personBox = await student(page).boundingBox();
      const sceneBox = await scene(page).boundingBox();
      expect(personBox.x).toBeGreaterThanOrEqual(sceneBox.x);
      expect(personBox.x + personBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + .5);
      expect(personBox.y + personBox.height).toBeLessThanOrEqual(sceneBox.y + sceneBox.height + .5);
      await page.clock.resume();
      await testInfo.attach(`pixel-${sourceType}-seated-${width}`, { body: await scene(page).screenshot(), contentType: 'image/png' });
      const nav = page.getByRole('navigation', { name: '主要ナビゲーション' });
      await nav.getByRole('button', { name: '予定', exact: true }).click();
      await nav.getByRole('button', { name: 'ホーム', exact: true }).click();
      await expect(student(page)).toHaveAttribute('data-pixel-student', 'studying');
      // Use the same deterministic registration boundary for the reload's
      // minute timer while still verifying an already-active mount.
      await page.clock.pauseAt(instant('10:20:59'));
      await page.reload(); await expect(scene(page)).toBeVisible(); await expect(student(page)).toHaveAttribute('data-pixel-student', 'studying');
      expect(await page.evaluate(() => Date.now())).toBe(instant('10:20:59').getTime());
      await page.clock.runFor(1000);
      await expect(student(page)).toHaveCount(0);
      await expect(page.locator('.home-next-card h1')).toHaveText('later');
      await page.clock.runFor(60_000); await expect(student(page)).toHaveAttribute('data-pixel-student', 'entering');
      await page.clock.runFor(60_000); await expect(student(page)).toHaveCount(0);
      expect(await data(page)).toEqual(originalData); expect(errors).toEqual([]);
    });

    for (const mode of ['off', 'reduced']) test(`${mode}: shows a seated person without movement`, async ({ page }) => {
      await page.clock.install({ time: instant('10:19:00') });
      await page.clock.pauseAt(instant('10:19:59'));
      await seed(page, { now: instant('10:19:00').toISOString(), motion: mode !== 'off' });
      if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(scene(page)).toBeVisible(); await expect(student(page)).toHaveCount(0);
      expect(await page.evaluate(() => Date.now())).toBe(instant('10:19:59').getTime());
      await page.clock.runFor(1000);
      await expect(student(page)).toHaveAttribute('data-pixel-student', 'studying');
      expect(await student(page).evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
      await page.clock.resume();
      await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
      const preview = page.locator('.home-scene-preview[data-scene-style="pixel"]');
      await expect(preview.locator('[data-pixel-student]')).toHaveAttribute('data-pixel-student', 'studying');
      expect(await preview.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    });

    test('a hidden start is already seated on resume', async ({ page }) => {
      await page.clock.install({ time: instant('10:19:00') });
      await seed(page, { now: instant('10:19:00').toISOString() });
      await page.goto('/');
      await expect(scene(page)).toBeVisible(); await expect(student(page)).toHaveCount(0);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.clock.pauseAt(instant('10:20:00'));
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(student(page)).toHaveAttribute('data-pixel-student', 'studying');
    });
  });
}
