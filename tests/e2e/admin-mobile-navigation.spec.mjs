import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const pages = ['/admin', '/admin/users', '/admin/ai', '/admin/planning', '/admin/logs', '/admin/system', '/admin/inquiries', '/admin/announcements', '/admin/users/actor-aaaaaaaa-1111-2222-3333-444444444444'];
const headings = ['Overview', 'Users', 'AI・API', 'Planning Analytics', 'Logs', 'System', 'お問い合わせ', 'お知らせ管理', 'ユーザー調査'];
async function open(page, route = '/admin', width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/*', r => ['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  await page.goto(`/admin-overview.html?view=mobile-admin&route=${encodeURIComponent(route)}`);
  await expect(page.locator('.admin-console-main')).toBeVisible();
  await expect(page.locator('.admin-console-main .admin-shell')).toBeVisible();
  await expect(page.locator('.admin-console-main').getByRole('heading', { level: 1, name: headings[pages.indexOf(route)], exact: true })).toBeVisible();
  await expect(page.locator('.admin-console-main').getByText(/^(読み込み中|Overviewを読み込んでいます|お問い合わせを読み込んでいます|お知らせを読み込んでいます)$/)).toHaveCount(0);
}
async function swipe(page, selector, from, to) {
  await page.locator(selector).first().evaluate((element, { from, to }) => {
    for (const [type, x] of [['touchstart', from], ['touchmove', to], ['touchend', to]]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 240 }] });
      element.dispatchEvent(event);
    }
  }, { from, to });
}
for (const width of [320, 390, 1280]) test(`admin all pages fit at ${width}px; dates stay inside their labels`, async ({ page }, info) => {
  test.setTimeout(90000); // Nine routes must all report geometry even when soft assertions fail.
  const evidence = [];
  const check = expect.configure({ soft: true });
  const dir = path.resolve('artifacts/admin-overview'); fs.mkdirSync(dir, { recursive: true });
  try {
    for (const route of pages) {
      await open(page, route, width);
      // Keep every route's geometry, including the first failing one.
      const layout = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        return {
          viewport, scrollWidth: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('body *')].flatMap(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (!rect.width || style.visibility === 'hidden' || (rect.right <= viewport + 1 && rect.left >= -1)) return [];
            return [{ tag: element.tagName, className: element.getAttribute('class'), x: rect.x, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, overflowX: style.overflowX }];
          }),
        };
      });
      const record = { route, layout }; evidence.push(record);
      if (route === '/admin/ai' || route.includes('/admin/users/')) {
        const textBoxes = await page.locator('.admin-ai-shell .admin-overview-metric-copy, .admin-observability-timeline-item > div').evaluateAll(containers => containers.map(container => {
          const box = container.getBoundingClientRect();
          return {
            x: box.x, right: box.right,
            children: [...container.querySelectorAll(':scope > strong, :scope > p, :scope > small, :scope > span')].map(child => {
              const rect = child.getBoundingClientRect();
              return { text: child.textContent, x: rect.x, right: rect.right, width: rect.width, scrollWidth: child.scrollWidth, clientWidth: child.clientWidth };
            }),
          };
        }));
        record.textBoxes = textBoxes;
        check(textBoxes.length, `${route} text containers`).toBeGreaterThan(0);
        for (const box of textBoxes) for (const child of box.children) {
          check(child.width, `${route}: ${child.text}`).toBeGreaterThan(0);
          check(child.x, `${route}: ${child.text}`).toBeGreaterThanOrEqual(box.x - 1);
          check(child.right, `${route}: ${child.text}`).toBeLessThanOrEqual(box.right + 1);
          check(child.scrollWidth, `${route}: ${child.text}`).toBeLessThanOrEqual(child.clientWidth + 1);
        }
      }
      await check.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${route} at ${width}px must not overflow` }).toBeLessThanOrEqual(1);
      const vertical = await page.evaluate(() => ({ header: document.querySelector('.admin-return-header').getBoundingClientRect().bottom, main: document.querySelector('.admin-console-main').getBoundingClientRect().top }));
      check(vertical.main).toBeGreaterThanOrEqual(vertical.header - 1);
      const dates = await page.locator('input[type=date]').evaluateAll(inputs => inputs.map(input => {
        const r = input.getBoundingClientRect(); const label = input.closest('label').getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, labelX: label.x, labelRight: label.right, width: r.width };
      }));
      if (['/admin', '/admin/ai', '/admin/planning'].includes(route)) check(dates).toHaveLength(2);
      for (const date of dates) { check(date.x).toBeGreaterThanOrEqual(date.labelX - 1); check(date.right).toBeLessThanOrEqual(date.labelRight + 1); check(date.width).toBeGreaterThan(0); }
      if (dates.length === 2) check(dates[0].right <= dates[1].x + 1 || dates[0].bottom <= dates[1].y + 1).toBe(true);
      if (width < 821) {
        await check(page.getByRole('navigation', { name: '管理者画面ナビゲーション' })).toBeHidden();
        await check(page.getByRole('button', { name: '管理メニューを開く', exact: true })).toBeVisible();
      } else await check(page.getByRole('navigation', { name: '管理者画面ナビゲーション' })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await check(page.getByRole('link', { name: '通常画面へ戻る', exact: true })).toBeVisible();
      record.dates = dates;
      if (width === 390) {
        const dir = path.resolve('artifacts/admin-overview'); fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `mobile-${info.project.name}-${route.replaceAll('/', '-')}.png`), fullPage: true });
      }
    }
  } finally {
    fs.writeFileSync(path.join(dir, `mobile-layout-${info.project.name}-${width}.json`), JSON.stringify(evidence, null, 2));
  }
});

for (const motion of ['standard', 'reduced', 'off']) test(`drawer button/swipe/focus and stable return: ${motion}`, async ({ page }, info) => {
  await open(page);
  await page.evaluate(motion => { document.documentElement.dataset.motion = motion; }, motion);
  const toggle = page.getByRole('button', { name: '管理メニューを開く', exact: true });
  const nav = page.locator('#admin-navigation');
  await page.evaluate(() => {
    const pick = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
    window.__drawerBaseline = { header: pick('.admin-return-header'), main: pick('.admin-console-main') };
    window.__drawerFrames = [];
    const sample = () => { window.__drawerFrames.push({ time: performance.now(), sidebar: pick('#admin-navigation'), header: pick('.admin-return-header'), main: pick('.admin-console-main') }); window.__drawerFrame = requestAnimationFrame(sample); };
    sample();
  });
  await toggle.click();
  await expect(nav).toHaveAttribute('role', 'dialog');
  await expect(nav).toBeFocused();
  await expect(page.locator('.admin-console-main')).toHaveAttribute('inert', '');
  await expect.poll(() => nav.evaluate(e => Math.abs(e.getBoundingClientRect().x))).toBeLessThan(1);
  const geometry = await page.locator('.admin-console-main').evaluate(e => ({ x: e.getBoundingClientRect().x, transform: getComputedStyle(e).transform, duration: getComputedStyle(e).transitionDuration }));
  expect(geometry.x).toBeGreaterThan(200);
  const openDir = path.resolve('artifacts/admin-overview'); fs.mkdirSync(openDir, { recursive: true });
  await page.screenshot({ path: path.join(openDir, `drawer-open-${info.project.name}-${motion}.png`) });
  if (motion !== 'standard') expect(geometry.duration).toBe('0s');
  await expect.poll(() => page.evaluate(() => window.__drawerFrames.some(frame => Math.abs(frame.sidebar.x) < 1 && frame.main.x > 200))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('button', { name: '管理メニューを閉じる', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(nav.getByRole('button', { name: 'お知らせ', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden(); await expect(toggle).toBeFocused();
  await expect.poll(() => page.evaluate(() => { const frame = window.__drawerFrames.at(-1); return Math.max(Math.abs(frame.main.x - window.__drawerBaseline.main.x), Math.abs(frame.header.x - window.__drawerBaseline.header.x)); })).toBeLessThan(1);
  await expect.poll(() => page.evaluate(() => window.__drawerFrames.length)).toBeGreaterThan(3);
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__drawerFrame); return { baseline: window.__drawerBaseline, samples: window.__drawerFrames }; });
  expect(new Set(frames.samples.map(frame => frame.time)).size).toBeGreaterThan(3);
  for (const frame of frames.samples) {
    expect(frame.sidebar.right).toBeLessThanOrEqual(frame.header.x + 1);
    expect(frame.sidebar.right).toBeLessThanOrEqual(frame.main.x + 1);
    expect(Math.abs(frame.header.width - frames.baseline.header.width)).toBeLessThan(1);
    expect(Math.abs(frame.main.width - frames.baseline.main.width)).toBeLessThan(1);
  }
  const finalFrame = frames.samples.at(-1);
  expect(Math.abs(finalFrame.header.x - frames.baseline.header.x)).toBeLessThan(1);
  expect(Math.abs(finalFrame.main.x - frames.baseline.main.x)).toBeLessThan(1);
  fs.writeFileSync(path.join(openDir, `drawer-frames-${info.project.name}-${motion}.json`), JSON.stringify(frames, null, 2));
  await swipe(page, '.admin-console-main', 4, 140); // Reserved OS edge.
  await expect(nav).toBeHidden();
  await swipe(page, '.admin-console-main', 50, 155);
  await expect(nav).toBeVisible();
  await swipe(page, '#admin-navigation', 200, 90);
  await expect(nav).toBeHidden();
  // A new intentional touch resets ghost-click suppression; an immediate mouse
  // click after synthetic touchend is not a separate mobile tap.
  await toggle.evaluate(element => {
    for (const type of ['touchstart', 'touchend']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: 50, clientY: 30 }] });
      element.dispatchEvent(event);
    }
  });
  await toggle.click();
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'AI・API', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI・API', exact: true })).toBeVisible();
  await expect(nav).toBeHidden();
  await swipe(page, 'input[type=date]', 50, 160);
  await expect(nav).toBeHidden();
  const table = page.locator('table').first();
  if (await table.count()) { await swipe(page, 'table', 150, 260); await expect(nav).toBeHidden(); }
  const dir = path.resolve('artifacts/admin-overview'); fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `drawer-${info.project.name}-${motion}.png`) });
  fs.writeFileSync(path.join(dir, `drawer-${info.project.name}-${motion}.json`), JSON.stringify(geometry));
});

test('Users chart has aligned integer ticks and exact daily table', async ({ page }) => {
  await open(page, '/admin/users', 390);
  const chart = page.locator('.admin-users-trend'); await expect(chart).toBeVisible();
  const ticks = await chart.locator('.admin-users-trend-count-axis span').allTextContents();
  expect(ticks.length).toBeGreaterThanOrEqual(2); expect(ticks.length).toBeLessThanOrEqual(5);
  ticks.forEach(tick => expect(tick).toMatch(/^\d+人$/));
  const alignment = await chart.evaluate(e => {
    const labels = [...e.querySelectorAll('.admin-users-trend-count-axis span')];
    const lines = [...e.querySelectorAll('.admin-users-trend-grid i')];
    return labels.map((label, i) => { const r = label.getBoundingClientRect(); return Math.abs(r.y + r.height / 2 - lines[i].getBoundingClientRect().y); });
  });
  alignment.forEach(delta => expect(delta).toBeLessThanOrEqual(1));
  const plotHeight = await chart.locator('.admin-users-trend-bars').evaluate(e => e.getBoundingClientRect().height);
  expect(plotHeight).toBeGreaterThan(100);
  const expected = [
    { date: '2026-08-23', count: '3人', height: 3 / 8 * plotHeight },
    { date: '2026-08-24', count: '0人', height: 0 },
    { date: '2026-08-25', count: 'データなし', height: 0 },
    { date: '2026-08-26', count: '7人', height: 7 / 8 * plotHeight },
  ];
  await expect(chart.locator('.admin-users-trend-bars span')).toHaveCount(4);
  expect(ticks).toEqual(['0人', '2人', '4人', '6人', '8人']);
  await chart.getByText('日別の人数を表示', { exact: true }).click();
  await expect(chart.locator('tbody tr')).toHaveCount(4);
  for (const row of expected) {
    const bar = chart.locator(`.admin-users-trend-bars span[data-date="${row.date}"]`);
    await expect(bar).toHaveCount(1);
    const height = await bar.evaluate(e => e.getBoundingClientRect().height);
    expect(Math.abs(height - row.height)).toBeLessThan(1);
    await expect(chart.getByRole('row').filter({ hasText: row.date })).toContainText(row.count);
    if (row.count === 'データなし') await expect(bar).toHaveAttribute('data-missing', 'true');
    else await expect(bar).not.toHaveAttribute('data-missing');
  }
});
