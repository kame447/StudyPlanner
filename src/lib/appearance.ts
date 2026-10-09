export type Appearance = 'standard' | 'pixel';

export function isAppearance(value: unknown): value is Appearance {
  return value === 'standard' || value === 'pixel';
}
