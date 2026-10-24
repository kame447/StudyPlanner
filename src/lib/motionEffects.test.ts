import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureAtRest, MOTION_DURATION_MS, playEntrance, playFromRect, playGrowth, playHop, playIndicatorTravel, playNavigation, playSettle, playShift } from './motionEffects';
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

describe('selection indicator travel', () => {
  it('travels from the previous place with individual properties at standard and ends in place', () => {
    const { element, animations } = fakeElement();
    playIndicatorTravel(element, -84);
    expect(animatedProperties(animations[0].frames)).toEqual(['scale', 'translate']);
    expect(animations[0].frames[0].translate).toBe('-84px 0');
    expect(animations[0].frames[animations[0].frames.length - 1]).toMatchObject({ translate: '0 0', scale: '1' });
    expect(animations[0].options.fill).toBeUndefined();
  });

  it('fades in place at reduced and does nothing at off', () => {
    setMotionPreference('reduced');
    const { element, animations } = fakeElement();
    playIndicatorTravel(element, 120);
    expect(animatedProperties(animations[0].frames)).toEqual(['opacity']);
    expect(animations[0].options.duration).toBe(REDUCED_FADE_MS);

    setMotionPreference('off');
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(playIndicatorTravel(element, 120)).toBeNull();
  });
});

describe('measuring at rest', () => {
  function animatedElement(playState: AnimationPlayState) {
    const calls: string[] = [];
    let time = 120;
    const animation = {
      playState,
      get currentTime() { return time; },
      set currentTime(value: number) { time = value; calls.push(`seek:${value}`); },
      effect: { getComputedTiming: () => ({ endTime: 210 }) },
      pause: () => calls.push('pause'),
      play: () => calls.push('play'),
      cancel: vi.fn(),
      addEventListener: vi.fn(),
    };
    const element = { animate: vi.fn(() => animation) } as unknown as Element;
    playShift(element, 0, 20);
    return { element, calls };
  }

  it('parks a running effect at its end for the measurement and resumes it where it was', () => {
    const { element, calls } = animatedElement('running');
    expect(measureAtRest(element, () => calls.length)).toBe(2);
    expect(calls).toEqual(['pause', 'seek:210', 'seek:120', 'play']);
  });

  it('leaves a finished effect alone instead of restarting it', () => {
    const { element, calls } = animatedElement('finished');
    expect(measureAtRest(element, () => 'measured')).toBe('measured');
    expect(calls).toEqual([]);
  });

  it('keeps a paused effect paused', () => {
    const { element, calls } = animatedElement('paused');
    measureAtRest(element, () => null);
    expect(calls).toEqual(['pause', 'seek:210', 'seek:120']);
  });
});

describe('value growth', () => {
  it('grows a bar from its previous length along one axis at standard, clamped', () => {
    const { element, animations } = fakeElement();
    playGrowth(element, 0.5);
    playGrowth(element, 80, 'x');
    expect(animations.map(animation => animation.frames[0].scale)).toEqual(['1 0.5', '50 1']);
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

describe('growing from another surface', () => {
  const placed = () => {
    const { element, animations } = fakeElement();
    Object.assign(element, { getBoundingClientRect: () => ({ left: 100, top: 200, width: 120, height: 160 }) });
    return { element, animations };
  };

  it('starts at the origin rectangle and ends in place at standard', () => {
    const { element, animations } = placed();
    playFromRect(element, { left: 10, top: 20, width: 60, height: 80 });
    // Centres (40, 60) → (160, 280); half the size.
    expect(animations[0].frames[0]).toEqual({ translate: '-120px -220px', scale: '0.500 0.500' });
    expect(animations[0].frames[1]).toEqual({ translate: '0 0', scale: '1 1' });
  });

  it('fades at reduced, does nothing at off or without a usable origin', () => {
    const { element, animations } = placed();
    expect(playFromRect(element, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    setMotionPreference('reduced');
    playFromRect(element, { left: 10, top: 20, width: 60, height: 80 });
    expect(animatedProperties(animations[0].frames)).toEqual(['opacity']);
    setMotionPreference('off');
    expect(playFromRect(element, { left: 10, top: 20, width: 60, height: 80 })).toBeNull();
  });
});

describe('companion hop', () => {
  it('hops in pixel steps and lands in place at standard', () => {
    const { element, animations } = fakeElement();
    playHop(element);
    expect(animatedProperties(animations[0].frames)).toEqual(['translate']);
    expect(animations[0].options.easing).toBe('steps(6, end)');
    expect(animations[0].frames[animations[0].frames.length - 1].translate).toBe('0 0');
  });

  it('is ambience, so nothing moves below standard', () => {
    setMotionPreference('reduced');
    const { element } = fakeElement();
    expect(playHop(element)).toBeNull();
    setMotionPreference('off');
    expect(playHop(element)).toBeNull();
  });
});
