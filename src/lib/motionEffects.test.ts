import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_DURATION_MS, playEntrance, playGrowth, playNavigation, playSettle } from './motionEffects';
import { MOTION_STORAGE_KEY, REDUCED_FADE_MS, setMotionPreference } from './motionPreference';
import { installFakeMotionEnvironment } from './motionPreference.testUtils';
import { readFileSync } from 'node:fs';

let env: ReturnType<typeof installFakeMotionEnvironment>;
beforeEach(() => { env = installFakeMotionEnvironment(); });
afterEach(() => env.restore());

function fakeElement() {
  const animations: Array<{ frames: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }> = [];
  const element = {
    animate: vi.fn((frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = { frames, options, cancel: vi.fn(), addEventListener: vi.fn() };
      animations.push(animation);
      return animation;
    }),
  };
  return { element: element as unknown as Element, animations };
}

const animatedProperties = (frames: Keyframe[]) =>
  [...new Set(frames.flatMap(frame => Object.keys(frame).filter(key => key !== 'offset')))].sort();

describe('feedback motion by level', () => {
  it('moves and scales only through individual properties at standard, so layout transforms are kept', () => {
    const { element, animations } = fakeElement();
    playEntrance(element);
    playSettle(element);
    playNavigation(element, 'forward');
    expect(animations.map(animation => animatedProperties(animation.frames))).toEqual([
      ['opacity', 'scale', 'translate'],
      ['scale'],
      ['opacity', 'translate'],
    ]);
    expect(animations.every(animation => animation.options.fill === undefined)).toBe(true);
    expect(animations[0].options.duration).toBe(MOTION_DURATION_MS.base);
  });

  it('uses opacity-only fades at reduced, including a device cap', () => {
    env.setSystemReduced(true);
    const { element, animations } = fakeElement();
    playEntrance(element);
    playSettle(element);
    playNavigation(element, 'backward');
    expect(animations.map(animation => animatedProperties(animation.frames))).toEqual([['opacity'], ['opacity'], ['opacity']]);
    expect(animations.every(animation => animation.options.duration === REDUCED_FADE_MS)).toBe(true);
  });

  it('stops a running effect when the level drops or the next effect is suppressed', () => {
    const { element, animations } = fakeElement();
    playSettle(element);
    setMotionPreference('reduced');
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);

    playEntrance(element);
    setMotionPreference('off');
    expect(animations[1].cancel).toHaveBeenCalledTimes(1);
    expect(playSettle(element)).toBeNull();
  });

  it('does nothing at off', () => {
    setMotionPreference('off');
    expect(env.storage.getItem(MOTION_STORAGE_KEY)).toBe('off');
    const { element } = fakeElement();
    expect(playEntrance(element)).toBeNull();
    expect(playSettle(element)).toBeNull();
    expect(playNavigation(element, 'forward')).toBeNull();
    expect((element as unknown as { animate: ReturnType<typeof vi.fn> }).animate).not.toHaveBeenCalled();
  });

  it('replaces a running effect instead of stacking on rapid repeats', () => {
    const { element, animations } = fakeElement();
    playNavigation(element, 'forward');
    playNavigation(element, 'backward');
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(animations[1].frames[0].translate).toBe('-18px 0');
  });

  it('tolerates a missing element or an engine without Web Animations', () => {
    expect(playEntrance(null)).toBeNull();
    expect(playSettle({} as Element)).toBeNull();
  });

  it('keeps its standard durations equal to the CSS tokens', () => {
    const css = readFileSync(new URL('../styles/motion.css', import.meta.url), 'utf8');
    for (const [name, ms] of Object.entries(MOTION_DURATION_MS)) {
      expect(css).toContain(`--motion-duration-${name}: ${ms}ms;`);
    }
  });
});

describe('value growth', () => {
  it('grows a bar from its previous length along one axis at standard, clamped', () => {
    const { element, animations } = fakeElement();
    playGrowth(element, 0.5);
    playGrowth(element, 9, 'x');
    expect(animations.map(animation => animation.frames[0].scale)).toEqual(['1 0.5', '4 1']);
    expect(animations[1].frames[animations[1].frames.length - 1].scale).toBe('1 1');
  });

  it('only brightens at reduced and does nothing at off', () => {
    setMotionPreference('reduced');
    const { element, animations } = fakeElement();
    playGrowth(element, 0.5);
    expect(animatedProperties(animations[0].frames)).toEqual(['opacity']);
    setMotionPreference('off');
    expect(playGrowth(element, 0.5)).toBeNull();
  });
});
