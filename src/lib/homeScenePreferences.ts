export type HomeSceneStyle = 'pixel' | 'pixel-cat' | 'pixel-turtle' | 'cozy' | 'minimal';

export interface HomeScenePreferences {
  style: HomeSceneStyle;
  animated: boolean;
}

export const DEFAULT_HOME_SCENE_PREFERENCES: HomeScenePreferences = {
  style: 'pixel',
  animated: false,
};

export const HOME_SCENE_STYLE_OPTIONS: { id: HomeSceneStyle; label: string }[] = [
  { id: 'pixel', label: 'ピクセル' },
  { id: 'pixel-cat', label: 'ピクセル・猫' },
  { id: 'pixel-turtle', label: 'ピクセル・亀' },
  { id: 'cozy', label: 'イラスト' },
  { id: 'minimal', label: 'ミニマル' },
];

export function isHomeSceneStyle(value: unknown): value is HomeSceneStyle {
  return value === 'pixel' || value === 'pixel-cat' || value === 'pixel-turtle'
    || value === 'cozy' || value === 'minimal';
}
