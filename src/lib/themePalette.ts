export type ThemeMode = 'light' | 'dark';

export type ThemePalette = 'forest' | 'ocean' | 'sakura' | 'amber' | 'violet';

interface ThemePaletteVariant {
  accent: string;
  accentStrong: string;
  chipText: string;
  actualBarStart?: string;
}

interface ThemePaletteDefinition {
  label: string;
  description: string;
  swatches: [string, string, string];
  light: ThemePaletteVariant;
  dark: ThemePaletteVariant;
}

export interface ThemePaletteOption {
  id: ThemePalette;
  label: string;
  description: string;
  swatches: [string, string, string];
}

const THEME_PALETTE_DEFINITIONS: Record<ThemePalette, ThemePaletteDefinition> = {
  forest: {
    label: 'フォレスト',
    description: '今の落ち着いた緑系です。',
    swatches: ['#176d66', '#2f8f84', '#dceeea'],
    light: {
      accent: '#176d66',
      accentStrong: '#114c47',
      chipText: '#114c47',
      actualBarStart: '#2e9e84',
    },
    dark: {
      accent: '#59b7ab',
      accentStrong: '#2f8f84',
      chipText: '#cff5ef',
      actualBarStart: '#7ad7cb',
    },
  },
  ocean: {
    label: 'オーシャン',
    description: '青系でスッキリ見せます。',
    swatches: ['#2f6fc2', '#3a90e8', '#d7e8fb'],
    light: {
      accent: '#2f6fc2',
      accentStrong: '#1c4f8d',
      chipText: '#1c4f8d',
      actualBarStart: '#4892ee',
    },
    dark: {
      accent: '#6fb2ff',
      accentStrong: '#2f78ca',
      chipText: '#dcedff',
      actualBarStart: '#8cc3ff',
    },
  },
  sakura: {
    label: 'サクラ',
    description: 'やわらかいピンク系です。',
    swatches: ['#c75a86', '#e18db1', '#f7dce6'],
    light: {
      accent: '#c75a86',
      accentStrong: '#8f3d61',
      chipText: '#8f3d61',
      actualBarStart: '#df7ca7',
    },
    dark: {
      accent: '#ef94ba',
      accentStrong: '#c75a86',
      chipText: '#ffe6f0',
      actualBarStart: '#f6abc9',
    },
  },
  amber: {
    label: 'アンバー',
    description: '黄みの強い暖色系です。',
    swatches: ['#bf7c24', '#e2a44d', '#f7e3c6'],
    light: {
      accent: '#bf7c24',
      accentStrong: '#875617',
      chipText: '#875617',
      actualBarStart: '#db9836',
    },
    dark: {
      accent: '#efb45a',
      accentStrong: '#bf7c24',
      chipText: '#fff0cf',
      actualBarStart: '#f7c979',
    },
  },
  violet: {
    label: 'バイオレット',
    description: 'やや締まった紫系です。',
    swatches: ['#6a56b7', '#917be2', '#e3dcf7'],
    light: {
      accent: '#6a56b7',
      accentStrong: '#493a82',
      chipText: '#493a82',
      actualBarStart: '#8870d7',
    },
    dark: {
      accent: '#ab9af2',
      accentStrong: '#6a56b7',
      chipText: '#ede8ff',
      actualBarStart: '#c0b1ff',
    },
  },
};

function hexToRgbChannels(hexColor: string): [number, number, number] {
  const normalized = hexColor.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized
        .split('')
        .map((value) => value + value)
        .join('')
    : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return [red, green, blue];
}

function rgba(hexColor: string, alpha: number): string {
  const [red, green, blue] = hexToRgbChannels(hexColor);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export const THEME_PALETTE_OPTIONS: ThemePaletteOption[] = (
  Object.entries(THEME_PALETTE_DEFINITIONS) as Array<[ThemePalette, ThemePaletteDefinition]>
).map(([id, definition]) => ({
  id,
  label: definition.label,
  description: definition.description,
  swatches: definition.swatches,
}));

export function getThemePaletteCssVariables(
  themePalette: ThemePalette,
  themeMode: ThemeMode,
): Record<`--${string}`, string> {
  const definition = THEME_PALETTE_DEFINITIONS[themePalette];
  const variant = definition[themeMode];
  const actualBarStart = variant.actualBarStart ?? variant.accent;
  const isDark = themeMode === 'dark';

  return {
    '--accent': variant.accent,
    '--accent-strong': variant.accentStrong,
    '--border-strong': rgba(variant.accent, isDark ? 0.24 : 0.18),
    '--surface-selected': rgba(variant.accent, isDark ? 0.24 : 0.12),
    '--input-border': rgba(variant.accent, isDark ? 0.22 : 0.14),
    '--button-ghost-border': rgba(variant.accent, isDark ? 0.16 : 0.12),
    '--chip-bg': rgba(variant.accent, isDark ? 0.16 : 0.08),
    '--chip-text': variant.chipText,
    '--mailbox-background': isDark
      ? `linear-gradient(160deg, ${rgba(variant.accent, 0.18)}, rgba(13, 17, 19, 0.92))`
      : `linear-gradient(160deg, ${rgba(variant.accent, 0.08)}, rgba(255, 255, 255, 0.8))`,
    '--assistant-feedback-background': rgba(variant.accent, isDark ? 0.12 : 0.08),
    '--assistant-feedback-border': rgba(variant.accent, isDark ? 0.16 : 0.12),
    '--notice-info-background': rgba(variant.accent, isDark ? 0.14 : 0.1),
    '--notice-info-border': rgba(variant.accent, isDark ? 0.2 : 0.16),
    '--notice-success-background': rgba(variant.accent, isDark ? 0.18 : 0.14),
    '--notice-success-border': rgba(variant.accent, isDark ? 0.24 : 0.2),
    '--score-comment-background': rgba(variant.accent, isDark ? 0.12 : 0.08),
    '--timeline-label-actual-bg': rgba(variant.accent, isDark ? 0.14 : 0.08),
    '--timeline-label-actual-border': rgba(variant.accent, isDark ? 0.18 : 0.12),
    '--timeline-canvas-split-overlay': isDark
      ? `linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0%, rgba(255, 255, 255, 0.02) 50%, ${rgba(variant.accent, 0.05)} 50%, ${rgba(variant.accent, 0.05)} 100%)`
      : `linear-gradient(90deg, rgba(54, 61, 64, 0.04) 0%, rgba(54, 61, 64, 0.04) 50%, ${rgba(variant.accent, 0.04)} 50%, ${rgba(variant.accent, 0.04)} 100%)`,
    '--timeline-legend-border': rgba(variant.accent, isDark ? 0.12 : 0.08),
    '--detail-card-border': rgba(variant.accent, isDark ? 0.22 : 0.18),
    '--month-selection-outline': rgba(variant.accent, isDark ? 0.46 : 0.42),
    '--month-selection-today-outline': rgba(variant.accent, isDark ? 0.22 : 0.18),
    '--comparison-track-bg': rgba(variant.accent, isDark ? 0.18 : 0.12),
    '--comparison-plan-start': rgba(variant.accent, isDark ? 0.18 : 0.16),
    '--comparison-plan-end': rgba(variant.accentStrong, isDark ? 0.34 : 0.28),
    '--comparison-actual-start': actualBarStart,
    '--comparison-actual-end': variant.accentStrong,
    '--focus-outline': rgba(variant.accent, isDark ? 0.42 : 0.34),
    '--accent-shadow': rgba(variant.accent, isDark ? 0.28 : 0.18),
    '--auth-tab-shadow': rgba(variant.accent, isDark ? 0.16 : 0.08),
    '--app-background': isDark
      ? `radial-gradient(circle at top left, ${rgba(variant.accent, 0.16)}, transparent 28%), linear-gradient(180deg, #12181b 0%, #0c1113 100%)`
      : `radial-gradient(circle at top left, ${rgba(variant.accent, 0.14)}, transparent 32%), linear-gradient(180deg, #f4efe4 0%, #edf4f1 100%)`,
  };
}
