import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { expect, test as base } from './support/fixed-clock.mjs';
import { currentMonthDays, seedRangeTestState, openSchedule, cellForDay,
  runMonthOvernightJourney } from './support/month-overnight-journey.mjs';
import { attachMonthObservation } from './support/month-overnight-observation.mjs';

// The broad Browser Regression config also discovers *.spec.mjs. Register no
// diagnostic cases there, or in an ordinary PR/push/full manual Matrix.
if (process.env.UI_EVENT_NAME === 'workflow_dispatch'
  && process.env.UI_SPEC === 'month-overnight-diagnostic.spec.mjs') {
// Temporary, manual-only delivery. Remove before merge unless adopted as a
// justified regression. Both arms run the same production bundle and journey.
const css = await fs.readFile(new URL('../../src/styles/schedule-day-sheet-motion.css', import.meta.url), 'utf8');
const entrance = css.slice(css.indexOf('@keyframes month-day-sheet-backdrop-in {'),
  css.indexOf('@keyframes month-day-sheet-backdrop-out {')).trim();
expect(entrance.startsWith('@keyframes month-day-sheet-backdrop-in {')).toBe(true);
const filters = /^\s*(?:-webkit-)?backdrop-filter:\s*blur\([03](?:px)?\);\s*$/gm;
expect(entrance.match(filters)).toHaveLength(4);
const treatment = entrance.replace(filters, '');
const sourceHash = createHash('sha256').update(css).digest('hex');
const gatePath = info => path.join(info.project.outputDir, 'month-backdrop-visual-admission.json');

const test = base.extend({
  // Every case changes the worker pool, including adjacent B arms. A failure
  // therefore cannot create arm-dependent browser reuse or warmup.
  monthWorkerKey: ['00-visual', { option: true, scope: 'worker' }],
  context: async ({ context, monthWorkerKey }, use) => {
    const arm = monthWorkerKey.endsWith('-B') ? 'B' : 'A';
    await context.addInitScript(({ arm, text, sourceHash }) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.id = 'month-backdrop-experiment'; style.textContent = text;
        document.head.append(style);
        globalThis.__monthBackdropExperiment = { arm, sourceHash };
      }, { once: true });
    }, { arm, text: arm === 'B' ? treatment : entrance, sourceHash });
    await use(context);
  },
});

test.use({ viewport: { width: 1280, height: 900 }, screen: { width: 1280, height: 900 }, reducedMotion: 'reduce' });

async function inspectSheet(page, text) {
  return page.evaluate(async text => {
    document.getElementById('month-backdrop-experiment').textContent = text;
    const sheet = document.querySelector('.month-day-sheet-overlay');
    await Promise.all(sheet.getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const selectors = ['.schedule-month-view', '.month-day-sheet-overlay', '.month-day-sheet',
      '.month-day-sheet-event', '.primary-bottom-nav'];
    const geometry = selectors.map(selector => {
      const element = document.querySelector(selector), box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { selector, rect: [box.x, box.y, box.width, box.height],
        backdrop: style.getPropertyValue('backdrop-filter'), prefixedBackdrop: style.getPropertyValue('-webkit-backdrop-filter'),
        background: style.background, opacity: style.opacity, transform: style.transform,
        zIndex: style.zIndex, overflow: style.overflow, position: style.position };
    });
    const target = document.querySelector('.month-day-sheet-event'), rect = target.getBoundingClientRect();
    return { geometry, hitTarget: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.month-day-sheet-event') === target,
      appearance: document.documentElement.dataset.appearance, theme: document.documentElement.dataset.theme,
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      rule: document.getElementById('month-backdrop-experiment').sheet.cssRules[0].cssText };
  }, text);
}

async function difference(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const decode = async source => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    };
    const left = await decode(a), right = await decode(b);
    if (left.width !== right.width || left.height !== right.height) return { sameDimensions: false };
    let changedPixels = 0;
    for (let i = 0; i < left.pixels.length; i += 4)
      if (left.pixels[i] !== right.pixels[i] || left.pixels[i + 1] !== right.pixels[i + 1]
        || left.pixels[i + 2] !== right.pixels[i + 2] || left.pixels[i + 3] !== right.pixels[i + 3]) changedPixels++;
    return { sameDimensions: true, changedPixels };
  }, [a.toString('base64'), b.toString('base64')]);
}

test('00 settled visual admission: A B A repeat', async ({ page }, info) => {
  await fs.rm(gatePath(info), { force: true });
  const dates = currentMonthDays(), now = new Date().toISOString();
  await seedRangeTestState(page, [{ id: 'month-backdrop-event', userId: 'month-range-user',
    date: dates.startDate, endDate: dates.middleDate, title: '翌朝までの予定 1280', startTime: '18:00', endTime: '09:00',
    repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now }]);
  await openSchedule(page);
  await cellForDay(page.getByRole('grid', { name: '月間カレンダー' }), page, dates.startDay).click();
  await expect(page.locator('.month-day-sheet-event')).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
  const a = await inspectSheet(page, entrance), imageA = await page.screenshot({ animations: 'disabled' });
  const b = await inspectSheet(page, treatment), imageB = await page.screenshot({ animations: 'disabled' });
  const a2 = await inspectSheet(page, entrance), imageA2 = await page.screenshot({ animations: 'disabled' });
  const comparison = await difference(page, imageA, imageB), stability = await difference(page, imageA, imageA2);
  const evidence = { sourceHash, a, b, a2, comparison, stability, retry: info.retry };
  await info.attach('month-backdrop-visual-admission', { body: JSON.stringify(evidence), contentType: 'application/json' });
  for (const [name, body] of [['baseline-A', imageA], ['static-blur-B', imageB], ['baseline-A-repeat', imageA2]])
    await info.attach(name, { body, contentType: 'image/png' });
  for (const state of [a, b, a2]) {
    expect(state.appearance).toBe('standard'); expect(state.theme).toBe('light');
    expect(state.viewport).toEqual([1280, 900]); expect(state.dpr).toBe(3); expect(state.reduced).toBe(true);
    expect(state.hitTarget).toBe(true);
    expect(state.geometry[1].backdrop).toBe('blur(3px)'); expect(state.geometry[1].prefixedBackdrop).toBe('blur(3px)');
  }
  expect(b.rule).not.toMatch(/backdrop-filter/); expect(a.rule).toMatch(/backdrop-filter/);
  expect(b.geometry).toEqual(a.geometry); expect(a2).toEqual(a);
  expect(comparison).toEqual({ sameDimensions: true, changedPixels: 0 });
  expect(stability).toEqual({ sameDimensions: true, changedPixels: 0 });
  // A flaky visual gate cannot admit performance interpretation.
  await fs.mkdir(info.project.outputDir, { recursive: true });
  await fs.writeFile(gatePath(info), JSON.stringify({ sourceHash, firstAttempt: info.retry === 0, evidence }));
});

for (const key of ['01-A', '02-B', '03-B', '04-A']) {
  const armTest = test.extend({ monthWorkerKey: [key, { option: true, scope: 'worker' }] });
  armTest.describe(key, () => {
    armTest.afterEach(async ({}, info) => { await attachMonthObservation(info); });
    armTest('unchanged 1280px overnight acceptance', async ({ page }, info) => {
      const gate = JSON.parse(await fs.readFile(gatePath(info), 'utf8'));
      expect(gate.sourceHash).toBe(sourceHash); expect(gate.firstAttempt).toBe(true);
      await info.attach('month-backdrop-arm', { body: JSON.stringify({ key, sourceHash, workerIndex: info.workerIndex,
        parallelIndex: info.parallelIndex, retry: info.retry, gate: 'first-pass exact settled RGBA',
        node: process.version, browser: page.context().browser().version(), host: os.hostname(),
        cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, platform: os.platform(), release: os.release(),
        checkout: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        configuredCapture: { trace: info.project.use.trace, video: info.project.use.video } }), contentType: 'application/json' });
      await runMonthOvernightJourney(page, info, 1280);
    });
  });
}
}
