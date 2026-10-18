import { expect, test } from './support/fixed-clock.mjs';
import { observeWindow, finishProcessIdentity, readAdmission, validateAdmission, measureStep } from './support/material-wpe-observation.mjs';

// Diagnostic only. Fixed PR741 App52eb, original two-document seed and unchanged
// 30s/retry/DPR/recording. This ends at Cancel trial, not Cancel/reload acceptance.
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


async function captureMaterialText(locator, boundary, testInfo, name) {
  const metrics = await locator.evaluate((element, boundarySelector) => {
    const box = element.getBoundingClientRect();
    const frame = element.closest(boundarySelector).getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element);
    const rect = value => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height });
    return { text: element.textContent, box: rect(box), frame: rect(frame),
      fragments: [...range.getClientRects()].map(rect),
      font: getComputedStyle(element).fontFamily, fontSize: getComputedStyle(element).fontSize,
      overflowWrap: getComputedStyle(element).overflowWrap };
  }, boundary);
  await testInfo.attach(name, { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(metrics.fragments.length).toBeGreaterThan(0);
  expect(metrics.box.width).toBeGreaterThan(0);
  for (const fragment of metrics.fragments) {
    expect.soft(fragment.left, name).toBeGreaterThanOrEqual(metrics.box.left - 1);
    expect.soft(fragment.right, name).toBeLessThanOrEqual(metrics.box.right + 1);
    expect.soft(fragment.left, name).toBeGreaterThanOrEqual(metrics.frame.left - 1);
    expect.soft(fragment.right, name).toBeLessThanOrEqual(metrics.frame.right + 1);
  }
}

async function reachMaterialControl(control, testInfo, name) {
  // Focus uses native scrolling; the trial click performs the normal stable,
  // visible, enabled and hit-target checks before we inspect its final position.
  let actionError;
  try {
    await control.focus();
    await control.click({ trial: true });
  } catch (error) {
    actionError = error;
  }
  const metrics = await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const blockers = [];
    const clippingFrames = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        const frame = ancestor.getBoundingClientRect();
        // Root overflow is applied to the viewport. Its clientHeight is also
        // viewport-sized, while its bounding rect moves with document scroll.
        const top = ancestor === document.documentElement ? 0 : frame.top + ancestor.clientTop;
        const bottom = top + ancestor.clientHeight;
        clippingFrames.push({ tag: ancestor.tagName, className: ancestor.className,
          top, bottom, rectTop: frame.top, scrollTop: ancestor.scrollTop, overflowY: style.overflowY });
        if (box.top < top - 1 || box.bottom > bottom + 1) blockers.push(`${ancestor.tagName}.${ancestor.className}`);
      }
    }
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      width: innerWidth, height: innerHeight, fontSize: getComputedStyle(element).fontSize, blockers, clippingFrames };
  }).catch(error => { throw actionError ?? error; });
  await testInfo.attach(name, { body: JSON.stringify({ ...metrics, actionabilityError: actionError?.message ?? null }), contentType: 'application/json' })
    .catch(error => { throw actionError ?? error; });
  if (actionError) throw actionError;
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.height + 1);
  expect(metrics.blockers).toEqual([]);
  await expect(control).toBeFocused();
}


const longMaterialName = 'MATERIALTOKEN'.repeat(20);
const longMaterialSubject = 'SUBJECTTOKEN'.repeat(14);
const longMaterialActivity = 'ACTIVITYTOKEN'.repeat(20);


test.use({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 3, contextOptions: { reducedMotion: 'reduce' }, trace: 'on' });
test.describe('material WPE resource observation', () => {
  let evidence;
  test.afterEach(async ({}, testInfo) => {
    if (!evidence) return;
    evidence.recordedTestErrors = testInfo.errors.map(error => error.message ?? String(error));
    await testInfo.attach('material-wpe-resource-observation', {
      body: JSON.stringify(evidence), contentType: 'application/json' });
    // Preserve the measurements first. Executable hashing cannot delay their
    // only durable attachment; identity is supplemental and outside each window.
    const identity = await finishProcessIdentity(evidence.windows);
    await testInfo.attach('material-wpe-process-identity', {
      body: JSON.stringify(identity), contentType: 'application/json' });
  });
  test('observes original 200% Cancel preparation with native frames timers and resource counters', async ({ page, browser }, testInfo) => {
    evidence = { appSource: '52ebec9f10b6ef8edaf0b00b906e2d35246ecd99', diagnosticOnly: true,
      retry: testInfo.retry, phases: [], windows: [], admissions: [],
      interpretation: 'Fewer than two frames or three timers means incomplete observation, never zero delay. Counter absence is missing data. This observation cannot accept the original Save/Cancel/reload scenario.',
      browser: { name: browser.browserType().name(), version: browser.version(),
        expectedExecutable: browser.browserType().executablePath() },
      project: { name: testInfo.project.name, timeout: testInfo.timeout, use: {
        viewport: testInfo.project.use.viewport, deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
        trace: testInfo.project.use.trace, video: testInfo.project.use.video } } };
    expect(testInfo.project.name).toBe('webkit-mobile'); expect(testInfo.timeout).toBe(30_000);
    const timed = (name, work) => measureStep(evidence.phases, name, work);
    await page.exposeBinding('__wpeDiagnosticEmit', (_source, event) => {
      const window = evidence.windows.find(value => value.name === event.name);
      if (!window || window.browserEvents.length >= 8) throw new Error('Unexpected or excessive telemetry');
      window.browserEvents.push(event);
    });
    const observed = (name, locator, work) => observeWindow({ page, locator, name, windows: evidence.windows, work });
    const admit = async name => {
      if (name === 'home-before-pixel-nav') {
        await expect.poll(async () => {
          const paint = await page.locator('.home-bottom-nav').evaluate(readAdmission);
          evidence.admissions.push({ name, paint });
          try { validateAdmission(paint); return true; } catch { return false; }
        }, { message: 'Original pixel paint must be loaded before observation' }).toBe(true);
      }
      const paint = await page.locator('.home-bottom-nav').evaluate(readAdmission);
      evidence.admissions.push({ name, paint }); validateAdmission(paint);
    };
    try {
        await seedBookshelf(page);
        // The unmodified ordinary boot/migration is standard, outside the
        // pixel-only treatment. Keep it instead of using the new preseed.
        await timed('ordinary-standard-initial-open', () => openBookshelf(page));
        await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
          // Mutate only this already-seeded fixture, avoiding init-script ordering assumptions.
          await page.evaluate(({ name, subject, activity }) => {
            const materials = JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1'));
            Object.assign(materials[0], { name, subjectName: subject });
            localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(materials));
            const subjects = JSON.parse(localStorage.getItem('studyplanner.studySubjects.v1'));
            subjects[0].name = subject;
            localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify(subjects));
            const plans = JSON.parse(localStorage.getItem('studyplanner.plans'));
            Object.assign(plans[0], { title: activity, subject, materialName: name });
            localStorage.setItem('studyplanner.plans', JSON.stringify(plans));
            // First entry has already migrated plans. Update the same owned
            // canonical record rather than leaving its displayed title unchanged.
            const events = JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1'));
            const event = events.find(row => row.userId === plans[0].userId
              && row.provenance?.legacy.kind === 'plan' && row.provenance.legacy.id === plans[0].id);
            if (!event?.plan) throw new Error('Expected the seeded material plan to be migrated');
            Object.assign(event, { title: activity });
            Object.assign(event.plan, { subject, materialName: name });
            localStorage.setItem('studyplanner.scheduleEvents.v1', JSON.stringify(events));
            const actuals = JSON.parse(localStorage.getItem('studyplanner.actuals'));
            Object.assign(actuals[0], { note: activity, materialName: name });
            delete actuals[0].materialProgressUpdates;
            localStorage.setItem('studyplanner.actuals', JSON.stringify(actuals));
            const key = 'studyplanner:material-detail:v1:bookshelf-e2e-user:bookshelf-e2e-material';
            const preferences = JSON.parse(localStorage.getItem(key));
            preferences.structureItems = Array.from({ length: 24 }, (_, index) => ({ id: `long-${index}`, title: `${name}${index + 1}`, startUnit: index * 8, endUnit: (index + 1) * 8 }));
            localStorage.setItem(key, JSON.stringify(preferences));
            localStorage.setItem('study-planner-appearance', 'pixel');
            localStorage.setItem('study-planner-theme-mode', 'light');
          }, { name: longMaterialName, subject: longMaterialSubject, activity: longMaterialActivity });

        // Same second document and original nav click, with identical admission
        // reads added in each arm. No route interception or cache modification.
        await timed('pixel-document-navigation', () => page.goto('/'));
        await expect(page.locator('.primary-bottom-nav')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
        await admit('home-before-pixel-nav');
        await observed('pixel-home-material-nav', page.locator('.primary-bottom-nav button').filter({ hasText: '教材' }), () => page.locator('.primary-bottom-nav button').filter({ hasText: '教材' }).click());
        await expect(page.locator('.bookshelf-view')).toBeVisible();
        await admit('bookshelf-after-pixel-nav');
        const viewport = { width: 1920, height: 1080 };
        const percent = 200;
          await page.locator('.bookshelf-featured-card').filter({ hasText: longMaterialName }).click();
          const detail = page.locator('.bookshelf-detail-page');
          await expect(detail.locator('.bookshelf-detail-hero-copy h2')).toHaveText(longMaterialName);
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
          await expect.poll(() => detail.evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
          await page.evaluate(() => document.fonts.ready);
          expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
          // Each purpose has its own fixture and dynamic 100→200% transition.
          // Keep the same 30s budget for each independent user contract.
          expect(await page.locator('html').evaluate(element => getComputedStyle(element).fontSize)).toBe('16px');
          const initialFont = await detail.locator('.bookshelf-detail-hero-copy h2')
            .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          await page.evaluate(percent => { document.documentElement.style.fontSize = `${percent}%`; }, percent);
          const name = `${viewport.width}x${viewport.height}-${percent}`;
          const metadata = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, root: getComputedStyle(document.documentElement).fontSize }));
          await testInfo.attach(`material-viewport-${name}`, { body: JSON.stringify(metadata), contentType: 'application/json' });
          expect(metadata.width).toBe(viewport.width); expect(metadata.height).toBe(viewport.height);
          expect(parseFloat(metadata.root)).toBe(16 * percent / 100);
          await detail.locator('.bookshelf-detail-hero-copy h2').scrollIntoViewIfNeeded();
          await testInfo.attach(`material-detail-${name}`, { body: await page.screenshot({ scale: 'css', animations: 'disabled' }), contentType: 'image/png' });
          const heading = detail.locator('.bookshelf-detail-hero-copy h2');
          const font = await heading.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          if (percent === 200) expect(font).toBeGreaterThan(initialFont * 1.9);
            await captureMaterialText(heading, '.bookshelf-detail-page', testInfo, `material-name-${name}`);
            await expect(detail.locator('.bookshelf-detail-hero-copy p')).toHaveText(longMaterialSubject);
            await captureMaterialText(detail.locator('.bookshelf-detail-hero-copy p'), '.bookshelf-detail-page', testInfo, `material-subject-${name}`);
            for (const label of ['学習記録', '予定']) {
              await detail.getByRole('button', { name: label, exact: true }).click();
              const text = detail.locator('.bookshelf-activity-list small');
              await expect(text).toHaveText(longMaterialActivity);
              await captureMaterialText(text, '.bookshelf-activity-list', testInfo, `material-${label}-${name}`);
            }
            await detail.getByRole('button', { name: '目次', exact: true }).click();
            await expect(detail.locator('.bookshelf-detail-section-head p')).toContainText(longMaterialName);
            await captureMaterialText(detail.locator('.bookshelf-detail-section-head p'), '.bookshelf-detail-page', testInfo, `material-current-chapter-${name}`);
            await reachMaterialControl(detail.getByRole('button', { name: 'この教材を予定に追加', exact: true }), testInfo, `material-plan-action-${name}`);
          await detail.getByRole('button', { name: '編集', exact: true }).click();
          const editor = page.locator('.bookshelf-structure-editor');
          await expect(editor.getByLabel('章・節の名前 24', { exact: true })).toHaveValue(`${longMaterialName}24`);
          await testInfo.attach(`material-editor-${name}`, { body: await page.screenshot({ scale: 'css', animations: 'disabled' }), contentType: 'image/png' });
          await expect(editor.locator('.bookshelf-modal-title-row p')).toHaveText(longMaterialName);
          await captureMaterialText(editor.locator('.bookshelf-modal-title-row p'), '.bookshelf-structure-editor', testInfo, `material-editor-title-${name}`);
            const first = editor.getByLabel('章・節の名前 1', { exact: true });
            await first.fill(`破棄する章 ${percent}`);
            await expect(first).toHaveValue(`破棄する章 ${percent}`);
            await admit('editor-before-cancel');
            await observed('editor-cancel-focus-trial-and-bounds', editor.getByRole('button', { name: 'キャンセル', exact: true }), () => reachMaterialControl(editor.getByRole('button', { name: 'キャンセル', exact: true }), testInfo, `material-cancel-${name}`));
            await admit('editor-after-cancel-trial');


      evidence.completedThroughCancelTrial = true;
    } catch (error) { evidence.error = String(error); throw error; }
  });
});
