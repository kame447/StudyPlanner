import { expect, test } from './support/fixed-clock.mjs';

// Production App, weekly load/autosave/chat lifecycle and localStorage. The
// existing recovery harness substitutes only provider execution and exposes
// the production local repository; this is not real-model or Firestore proof.
const HARNESS = 'http://127.0.0.1:4174/full-planner-recovery.html';
const OWNER = 'planner-recovery-owner';
const WEEK = '2026-08-17';
const STABLE = `studyplanner.weeklyPlanning.stableV5.${OWNER}.${WEEK}`;
const COMPATIBILITY = `studyplanner.weeklyPlanning.${OWNER}.${WEEK}`;
const RETAINED = `studyplanner.weeklyPlanningUnreadable.v1.${OWNER}.${WEEK}`;
const INDEX = `studyplanner.weeklyPlanning.activeSession.${OWNER}`;
const UNREADABLE = [
  JSON.stringify({ version: 'future-stable-format', ownerId: OWNER, weekStartDate: WEEK,
    opaque: 'future-stable-byte-sentinel', payload: ['保持する', 17] }),
  JSON.stringify({ version: 'future-compatibility-format', ownerId: OWNER,
    opaque: 'future-compatibility-byte-sentinel', payload: ['こちらも保持する', 23] }),
];
const NEW_TEXT = '退避データを残したまま別の会話を始める';
const nav = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
const composer = page => page.locator('.ai-planning-composer textarea');

async function runtimeEvents(page) {
  // full-planner-recovery.jsx creates this array before rendering App; its
  // production-boundary gateway fixture appends dispatch events. Absence is a
  // broken observer, not evidence of no replay.
  expect(await page.evaluate(() => Array.isArray(window.__realWeeklyEvents))).toBe(true);
  return page.evaluate(() => window.__realWeeklyEvents.filter(event => event.type === 'real-runtime-execute'));
}

async function storedOpaqueBytes(page) {
  return page.evaluate(({ stable, compatibility, retained }) => {
    const values = [localStorage.getItem(stable), localStorage.getItem(compatibility)];
    const backup = localStorage.getItem(retained);
    if (backup) values.push(JSON.parse(backup).raw);
    return values.filter(value => value !== null);
  }, { stable: STABLE, compatibility: COMPATIBILITY, retained: RETAINED });
}

async function expectBothPreserved(page) {
  // Neither exact opaque payload may be lost, regardless of which source won
  // the bounded retention slot. Do not demand a second slot or decode its data.
  await expect.poll(() => storedOpaqueBytes(page)).toEqual(expect.arrayContaining(UNREADABLE));
  for (const marker of ['future-stable-byte-sentinel', 'future-compatibility-byte-sentinel']) {
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
  }
}

async function reloadDurableProfile(page) {
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  await expect(nav(page)).toBeVisible();
  await nav(page).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
}

test.describe.configure({ retries: 0 });
for (const width of [1280, 390]) {
  test(`opaque session collisions survive App load, new-chat autosave and reload at ${width}px`, async ({ page }, testInfo) => {
    const externalRequests = [];
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', route => {
      const { hostname, href } = new URL(route.request().url());
      if (['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return route.continue();
      externalRequests.push(href);
      return route.abort();
    });
    await page.goto(HARNESS);
    await expect(nav(page)).toBeVisible();
    await page.waitForFunction(() => window.__plannerRecoveryHook?.snapshot?.().ready === true);
    const durablePlans = await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'));

    // Seed only storage, before a real reload; never replace hook state or call
    // the loader directly. Both legacy/current slots contain unknown formats.
    await page.evaluate(({ stable, compatibility, index, owner, week, raw }) => {
      localStorage.setItem(stable, raw[0]);
      localStorage.setItem(compatibility, raw[1]);
      localStorage.setItem(index, JSON.stringify({ version: 1, ownerId: owner,
        weekStartDate: week, conversationId: 'future-opaque-conversation' }));
    }, { stable: STABLE, compatibility: COMPATIBILITY, index: INDEX, owner: OWNER, week: WEEK, raw: UNREADABLE });

    await reloadDurableProfile(page);
    await expectBothPreserved(page);
    expect(await runtimeEvents(page)).toEqual([]);
    await page.getByRole('button', { name: 'チャット一覧を開く', exact: true }).click();
    await page.getByRole('button', { name: '新しいチャット', exact: true }).click();
    await expect(composer(page)).toBeEnabled();
    await composer(page).fill(NEW_TEXT);
    await composer(page).press('Enter');
    await expect(page.locator('.ai-planning-message-row.user').getByText(NEW_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByText(`テスト応答: ${NEW_TEXT}`, { exact: true })).toBeVisible();
    expect(await runtimeEvents(page), 'the observer records the one scripted dispatch').toHaveLength(1);
    await expectBothPreserved(page);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toBe(durablePlans);

    await reloadDurableProfile(page);
    await expectBothPreserved(page);
    await expect(page.locator('.ai-planning-message-row.user').getByText(NEW_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByText(`テスト応答: ${NEW_TEXT}`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toBe(durablePlans);
    expect(await runtimeEvents(page)).toEqual([]);
    expect(externalRequests, 'no provider or live account request may escape loopback').toEqual([]);
    await testInfo.attach(`retained-session-${width}`, {
      body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
    });
  });
}
