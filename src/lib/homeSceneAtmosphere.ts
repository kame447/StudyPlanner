import { getMoonIllumination } from 'suncalc';

export type HomeSkyPeriod = 'dawn' | 'day' | 'sunset' | 'night';
export const HOME_SKY_PERIOD_LABELS: Record<HomeSkyPeriod, string> = {
  dawn: '朝焼け', day: '昼', sunset: '夕焼け', night: '夜',
};
export const HOME_MOON_PHASE_LABELS = [
  '新月ごろ', '満ちていく三日月', '上弦の月ごろ', '満月に向かう月',
  '満月ごろ', '欠けていく月', '下弦の月ごろ', '新月に向かう細い月',
] as const;

export interface HomeSceneAtmosphere {
  period: HomeSkyPeriod;
  moonPhase: number;
  moonStage: number;
  illuminatedFraction: number;
}

/** Decorative local-clock periods, not geographic sunrise/sunset predictions. */
export function homeSkyPeriod(hour: number): HomeSkyPeriod {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'sunset';
  return 'night';
}

export function moonPhaseStage(phase: number): number {
  if (!Number.isFinite(phase)) throw new RangeError('Invalid moon phase');
  const normalized = ((phase % 1) + 1) % 1;
  return Math.round(normalized * 8) % 8;
}

/** SunCalc uses the absolute instant; local calendar dates must not replace it. */
export function resolveHomeSceneAtmosphere(now: Date): HomeSceneAtmosphere {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid scene time');
  const moon = getMoonIllumination(now);
  return {
    period: homeSkyPeriod(now.getHours()),
    moonPhase: moon.phase,
    moonStage: moonPhaseStage(moon.phase),
    illuminatedFraction: moon.fraction,
  };
}

/** Conventional right-lit waxing / left-lit waning, not observer orientation. */
export function pixelMoonPaths(stage: number): { disc: string; light: string } {
  const normalized = ((Math.round(stage) % 8) + 8) % 8;
  const terminator = Math.cos(normalized * Math.PI / 4);
  const paths = { disc: '', light: '' };
  for (let y = 0; y < 12; y += 1) {
    const halfWidth = Math.sqrt(36 - (y + .5 - 6) ** 2);
    for (let x = 0; x < 12; x += 1) {
      const localX = x + .5 - 6;
      if (Math.abs(localX) > halfWidth) continue;
      const pixel = `M${x} ${y}h1v1h-1z`;
      paths.disc += pixel;
      if (normalized <= 4 ? localX >= terminator * halfWidth : localX <= -terminator * halfWidth) {
        paths.light += pixel;
      }
    }
  }
  return paths;
}
