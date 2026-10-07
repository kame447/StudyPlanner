export type HomeSceneStyle = 'pixel' | 'pixel-cat' | 'pixel-turtle' | 'cozy' | 'minimal';

export interface HomeScenePreferences {
  style: HomeSceneStyle;
  animated: boolean;
}

export const DEFAULT_HOME_SCENE_PREFERENCES: HomeScenePreferences = {
  style: 'pixel',
  animated: false,
};

export const HOME_SCENE_STYLE_OPTIONS: { id: HomeSceneStyle; label: string; description: string }[] = [
  { id: 'pixel', label: 'ピクセル', description: '小さなドットの、静かな部屋' },
  { id: 'pixel-cat', label: 'ピクセル・猫', description: 'しっぽを揺らす猫と、ひと休み' },
  { id: 'pixel-turtle', label: 'ピクセル・亀', description: 'ゆっくり歩く亀と、自分のペースで' },
  { id: 'cozy', label: 'イラスト', description: 'やわらかな線と、あたたかな光' },
  { id: 'minimal', label: 'ミニマル', description: '余白を楽しむ、シンプルな形' },
];

export function isHomeSceneStyle(value: unknown): value is HomeSceneStyle {
  return value === 'pixel' || value === 'pixel-cat' || value === 'pixel-turtle'
    || value === 'cozy' || value === 'minimal';
}
