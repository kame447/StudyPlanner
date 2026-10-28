import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FONT_PRESET_OPTIONS, WEB_FONT_STYLESHEETS, isFontPreset, loadAllWebFontStylesheets, loadWebFontStylesheet,
  resetWebFontStylesheetsForTest,
} from './fontPreset';

class FakeLink {
  rel = ''; href = ''; dataset: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  removed = false;
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  remove() { this.removed = true; }
  fire(type: 'load' | 'error') { this.listeners.get(type)?.(); }
}
function fakeDocument() {
  const links: FakeLink[] = [];
  vi.stubGlobal('document', {
    createElement: vi.fn(() => new FakeLink()),
    head: { append: vi.fn((link: FakeLink) => { links.push(link); }) },
  });
  return links;
}
afterEach(() => { resetWebFontStylesheetsForTest(); vi.unstubAllGlobals(); });

describe('font preset registry', () => {
  it('offers the system default first and exactly four presets', () => {
    expect(FONT_PRESET_OPTIONS.map(option => option.id)).toEqual(['system', 'noto-sans-jp', 'biz-udpgothic', 'm-plus-rounded-1c']);
  });

  it.each([null, undefined, '', 'SYSTEM', ' noto-sans-jp', 'Noto Sans JP', '__proto__', 'toString', 42])('rejects %j', value => {
    expect(isFontPreset(value)).toBe(false);
  });

  it('requests only Google Fonts CSS2 stylesheets with swap display and shipped weights', () => {
    for (const url of Object.values(WEB_FONT_STYLESHEETS)) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://fonts.googleapis.com');
      expect(parsed.pathname).toBe('/css2');
      expect(parsed.searchParams.get('display')).toBe('swap');
    }
    expect(new URL(WEB_FONT_STYLESHEETS['biz-udpgothic']).searchParams.get('family')).toBe('BIZ UDPGothic:wght@400;700');
  });
});

describe('on-demand stylesheet loading', () => {
  it('appends one stylesheet per preset and reuses a successful load', async () => {
    const links = fakeDocument();
    const first = loadWebFontStylesheet('noto-sans-jp');
    expect(loadWebFontStylesheet('noto-sans-jp')).toBe(first);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ rel: 'stylesheet', href: WEB_FONT_STYLESHEETS['noto-sans-jp'], dataset: { fontPreset: 'noto-sans-jp' } });
    links[0].fire('load');
    await expect(first).resolves.toBeUndefined();
    expect(links).toHaveLength(1);
  });

  it('removes a failed stylesheet so a later selection can retry', async () => {
    const links = fakeDocument();
    const failed = loadWebFontStylesheet('biz-udpgothic');
    links[0].fire('error');
    await expect(failed).rejects.toThrow();
    expect(links[0].removed).toBe(true);
    const retry = loadWebFontStylesheet('biz-udpgothic');
    expect(links).toHaveLength(2);
    links[1].fire('load');
    await expect(retry).resolves.toBeUndefined();
  });

  it('loads every web preset for comparison and reports a partial failure', async () => {
    const links = fakeDocument();
    const all = loadAllWebFontStylesheets();
    expect(links.map(link => link.dataset.fontPreset)).toEqual(['noto-sans-jp', 'biz-udpgothic', 'm-plus-rounded-1c']);
    links[0].fire('load'); links[1].fire('error'); links[2].fire('load');
    await expect(all).rejects.toThrow();
  });
});
