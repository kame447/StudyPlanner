export type FontPreset = 'system' | 'noto-sans-jp' | 'biz-udpgothic' | 'm-plus-rounded-1c';
export type WebFontPreset = Exclude<FontPreset, 'system'>;

export interface FontPresetOption {
  id: FontPreset;
  label: string;
}

// Font family stacks are owned by `styles/font-presets.css`; this registry owns
// recognition, labels and the on-demand Google Fonts stylesheet for each preset.
export const FONT_PRESET_OPTIONS: readonly FontPresetOption[] = [
  { id: 'system', label: '標準' },
  { id: 'noto-sans-jp', label: 'Noto Sans JP' },
  { id: 'biz-udpgothic', label: 'BIZ UDPゴシック' },
  { id: 'm-plus-rounded-1c', label: 'M PLUS Rounded 1c' },
];

export const FONT_PRESET_SAMPLE_TEXT = '今日の学習 数学 25分 ABC 123';

// Only the weights each family actually ships are requested; with
// `font-synthesis: none` the browser maps other app weights to the nearest one.
export const WEB_FONT_STYLESHEETS: Readonly<Record<WebFontPreset, string>> = {
  'noto-sans-jp': 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400..900&display=swap',
  'biz-udpgothic': 'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap',
  'm-plus-rounded-1c': 'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700;800&display=swap',
};

export function isFontPreset(value: unknown): value is FontPreset {
  return typeof value === 'string' && FONT_PRESET_OPTIONS.some(option => option.id === value);
}

export function isWebFontPreset(value: FontPreset): value is WebFontPreset {
  return value !== 'system';
}

const stylesheetLoads = new Map<WebFontPreset, Promise<void>>();

// Appends the preset's stylesheet once. A failed request is forgotten so a later
// selection can retry; the CSS fallback stack keeps the current system typeface.
export function loadWebFontStylesheet(preset: WebFontPreset): Promise<void> {
  const existing = stylesheetLoads.get(preset);
  if (existing) return existing;
  const load = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = WEB_FONT_STYLESHEETS[preset];
    link.dataset.fontPreset = preset;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => {
      link.remove();
      stylesheetLoads.delete(preset);
      reject(new Error(`Font stylesheet failed: ${preset}`));
    }, { once: true });
    document.head.append(link);
  });
  stylesheetLoads.set(preset, load);
  return load;
}

export function loadAllWebFontStylesheets(): Promise<void> {
  const presets = FONT_PRESET_OPTIONS.map(option => option.id).filter(isWebFontPreset);
  return Promise.allSettled(presets.map(loadWebFontStylesheet)).then(results => {
    if (results.some(result => result.status === 'rejected')) throw new Error('Font stylesheet failed');
  });
}

export function resetWebFontStylesheetsForTest() {
  stylesheetLoads.clear();
}
