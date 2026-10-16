import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

// Issue #696 S1: the selected circle of the primary navigation travels from the
// previous tab to the new one. Selection, aria-current and focus are settled at
// once; only the decorative circle moves, and only when the selection changes.

async function seed(page, motion) {
  await page.addInitScript(({ today, motion }) => {
    if (localStorage.getItem('nav-motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'nav-motion-user', email: 'nav@example.test', username: 'ナビ', avatar: '', createdAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
      localStorage.setItem(key, '[]');
    }
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('nav-motion-seeded', today);
  }, { today: E2E_TODAY, motion });
}

const nav = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
const tab = (page, name) => nav(page).getByRole('button', { name, exact: true });

/** Animations on the selected circle, with the start offset of any travel. */
const circleMotion = page => nav(page).evaluate(element => {
  const circle = element.querySelector('.home-nav-active-circle');
  return (circle?.getAnimations() ?? []).map(animation => {
    const frames = animation.effect.getKeyframes();
    return {
      properties: [...new Set(frames.flatMap(frame => Object.keys(frame)))]
        .filter(key => ['opacity', 'scale', 'translate', 'transform'].includes(key)).sort(),
      fromX: Number.parseFloat(String(frames[0].translate ?? '0')),
    };
  });
});

/** Where the circle is drawn, and where the selected item is. */
const landing = page => nav(page).evaluate(element => {
  const circle = element.querySelector('.home-nav-active-circle')?.getBoundingClientRect();
  const button = element.querySelector('[aria-current="page"]')?.getBoundingClientRect();
  return { circle: circle.left + circle.width / 2, button: button.left + button.width / 2 };
});

const centerOf = async locator => {
  const box = await locator.boundingBox();
  return box.x + box.width / 2;
};

async function expectSettled(page) {
  await expect.poll(async () => (await circleMotion(page)).length, { timeout: 2_000 }).toBe(0);
  const { circle, button } = await landing(page);
  expect(Math.abs(circle - button)).toBeLessThan(1);
}

for (const width of [320, 390, 1280]) {
  test(`the selected circle travels between tabs and lands on the selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page);
    await page.goto('/');
    await expect(tab(page, 'ホーム')).toHaveAttribute('aria-current', 'page');
    // The first paint is still.
    expect(await circleMotion(page)).toEqual([]);

    const home = await centerOf(tab(page, 'ホーム'));
    const shelf = await centerOf(tab(page, '教材'));
    await tab(page, '教材').click();
    await expect(tab(page, '教材')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, '教材')).toBeFocused();
    const travel = await circleMotion(page);
    expect(travel).toHaveLength(1);
    expect(travel[0].properties).toEqual(['scale', 'translate']);
    expect(Math.abs(travel[0].fromX - (home - shelf))).toBeLessThan(2);
    await expectSettled(page);

    // Pressing the tab that is already selected changes nothing, so nothing moves.
    await tab(page, '教材').click();
    expect(await circleMotion(page)).toEqual([]);

    // A resize re-lays out the bar but is not a selection change.
    await page.setViewportSize({ width: width + 40, height: 800 });
    expect(await circleMotion(page)).toEqual([]);
    await expectSettled(page);
  });
}

test('a quick reverse press continues from mid-flight and lands on the last choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');
  await tab(page, '時間割').click();
  await tab(page, 'AI計画').click();
  await expect(tab(page, 'AI計画')).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
  const travel = await circleMotion(page);
  expect(travel).toHaveLength(1);
  // It starts where the circle was drawn at the press, never further right
  // than 時間割 (where the first travel was heading).
  const ai = await centerOf(tab(page, 'AI計画'));
  const timetable = await centerOf(tab(page, '時間割'));
  expect(travel[0].fromX).toBeGreaterThan(0);
  expect(travel[0].fromX).toBeLessThanOrEqual(timetable - ai + 1);
  await expectSettled(page);
});

test('the device reduced-motion setting turns the travel into a short fade in place', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await tab(page, '予定').click();
  const fade = await circleMotion(page);
  expect(fade.map(animation => animation.properties)).toEqual([['opacity']]);
  await expectSettled(page);
});

test('off shows the new selection at once with no motion and no press dip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, 'off');
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await tab(page, '教材').click();
  expect(await circleMotion(page)).toEqual([]);
  await expectSettled(page);
  const pressed = await tab(page, '予定').evaluate(button => getComputedStyle(button).transitionDuration);
  expect(pressed.split(',').every(value => value.trim() === '0s')).toBe(true);
});

test('the travelling circle never takes a tap meant for the item it passes over', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');
  await tab(page, '時間割').click();
  // Mid-flight, whatever is under the circle's centre is the item drawn there,
  // never the circle (which would route the tap to the newly selected item).
  const hit = await nav(page).evaluate(element => {
    const circle = element.querySelector('.home-nav-active-circle');
    const box = circle.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height - 4);
    return { onCircle: Boolean(target?.closest('.home-nav-active-circle')), pointerEvents: getComputedStyle(circle).pointerEvents };
  });
  expect(hit).toEqual({ onCircle: false, pointerEvents: 'none' });

  // A real tap on 教材's icon while the circle may still be passing over it.
  const icon = await tab(page, '教材').locator('svg').boundingBox();
  await page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2);
  await expect(tab(page, '教材')).toHaveAttribute('aria-current', 'page');
  await expectSettled(page);
});

test('below standard a press does not animate its dip, even when the level changes mid-press', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');
  const duration = () => tab(page, '予定').evaluate(button => getComputedStyle(button).transitionDuration);
  expect(await duration()).toBe('0.15s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(await duration()).toBe('0s');
});

