import { createHash } from 'node:crypto';
import { expect, test as base } from './fixed-clock.mjs';
const evidence = new WeakMap();
const hash = text => createHash('sha256').update(text).digest('hex');
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const mode = process.env.GRID_DIAGNOSTIC_MODE;
    if (!['original', 'none'].includes(mode)) throw new Error('Explicit grid diagnostic mode required');
    const record = { mode, retry: testInfo.retry, title: testInfo.title, css: [], checkpoints: [], errors: [] };
    evidence.set(page, record);
    await page.route(url => url.hostname === '127.0.0.1' && url.port === '4173' && url.pathname.endsWith('.css'), async route => {
      try {
        const response = await route.fetch();
        if (!response.ok()) throw new Error(`CSS response status ${response.status()}`);
        const original = await response.text();
        const matches = [...original.matchAll(/--pixel-grid-paper\s*:\s*([^;{}]+)(?=[;}])/g)];
        if (matches.length > 1) throw new Error('Multiple grid declarations in one asset');
        let body = original;
        if (matches.length === 1) {
          const declaration = matches[0][0];
          if ((declaration.match(/repeating-linear-gradient\(/g) ?? []).length !== 2) throw new Error('Unexpected grid definition');
          if (mode === 'none') body = original.replace(declaration, '--pixel-grid-paper:none,none');
          const restored = mode === 'none' ? body.replace('--pixel-grid-paper:none,none', declaration) : body;
          if (restored !== original) throw new Error('Grid transformation changed other CSS');
        }
        record.css.push({ asset: new URL(route.request().url()).pathname, declarations: matches.length,
          originalSha256: hash(original), servedSha256: hash(body), restoredMatches: true });
        await route.fulfill({ response, body });
      } catch (error) { record.errors.push(String(error)); await route.abort('failed'); }
    });
    try { await use(page); }
    finally {
      if (!record.css.some(item => item.declarations === 1)) record.errors.push('No grid declaration response observed');
      if (new Set(record.css.filter(item => item.declarations === 1).map(item => item.asset)).size !== 1) record.errors.push('Expected exactly one grid asset');
      await testInfo.attach('grid-paint-proof', { body: JSON.stringify(record), contentType: 'application/json' });
      evidence.delete(page);
    }
  },
});
export { expect };
export async function captureGridProof(page, testInfo, phase) {
  const record = evidence.get(page);
  try {
    const value = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const selectors = ['html', 'body', '.app-shell', '.bookshelf-view', '.bookshelf-detail-page', '.bookshelf-detail-hero-copy h2', '.bookshelf-structure-editor', '.bookshelf-modal-title-row p', '.bookshelf-structure-editor input', '.bookshelf-structure-editor button'];
      const geometry = selectors.map(selector => ({ selector, elements: [...document.querySelectorAll(selector)].map(element => {
        const style = getComputedStyle(element);
        const range = document.createRange(); range.selectNodeContents(element);
        return { rect: rect(element), scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
          font: style.font, lineHeight: style.lineHeight, display: style.display, visibility: style.visibility, overflowX: style.overflowX, overflowY: style.overflowY,
          fragments: selector.endsWith('h2') || selector.endsWith(' p') ? [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })) : [] };
      }) }));
      const paint = ['html', 'body', '.app-shell'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { selector, image: style.backgroundImage, color: style.backgroundColor, size: style.backgroundSize, position: style.backgroundPosition, repeat: style.backgroundRepeat };
      });
      return { geometry, paint, rootFont: getComputedStyle(document.documentElement).fontSize,
        appearance: document.documentElement.dataset.appearance, theme: document.documentElement.dataset.theme,
        gridVariable: getComputedStyle(document.documentElement).getPropertyValue('--pixel-grid-paper').trim(),
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, scroll: { x: scrollX, y: scrollY },
        fontLoaded: document.fonts.check('16px DotGothic16') };
    });
    if (value.appearance !== 'pixel' || value.theme !== 'light' || value.viewport.dpr !== 3 || value.viewport.width !== 1920 || value.viewport.height !== 1080) throw new Error('Unexpected visual admission');
    for (const paint of value.paint) {
      if ((paint.image.match(/repeating-linear-gradient\(/g) ?? []).length !== (record.mode === 'original' ? 2 : 0)) throw new Error(`Unexpected grid layers: ${paint.selector}`);
      if (paint.selector === '.app-shell' && (paint.image.match(/repeating-conic-gradient\(/g) ?? []).length !== 1) throw new Error('App-shell conic decoration changed');
    }
    record.checkpoints.push({ phase, index: record.checkpoints.filter(x => x.phase === phase).length, ...value });
  } catch (error) { record.errors.push(`Checkpoint ${phase}: ${String(error)}`); }
}
