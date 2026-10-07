import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { HomeSceneAtmosphere, HomeSkyPeriod } from '../../../lib/homeSceneAtmosphere';
import { HomeScene } from '../HomeScene';
import { PixelSky } from './PixelSky';

const renderers: ReactTestRenderer[] = [];
const windowBounds = { x: 168, y: 32, width: 92, height: 72 };
const pixelStyles = ['pixel', 'pixel-cat', 'pixel-turtle'] as const;

function render(element: ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  renderers.push(renderer);
  return renderer;
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) act(() => renderer.unmount());
});

function atmosphere(period: HomeSkyPeriod, moonStage = 2): HomeSceneAtmosphere {
  return { period, moonStage, moonPhase: moonStage / 8, illuminatedFraction: .5 };
}

function pathsWithFill(root: ReactTestInstance, variable: string) {
  return root.findAll(node => node.type === 'path' && node.props.fill === `var(--scene-atmosphere-${variable})`);
}

function moonPaths(root: ReactTestInstance) {
  const moon = root.find(node => node.type === 'g' && node.props['data-moon-stage'] !== undefined);
  const disc = pathsWithFill(moon, 'moon-shadow')[0];
  const light = moon.findByProps({ 'data-moon-light': 'true' });
  expect(disc).toBeDefined();
  expect(light.props.fill).toBe('var(--scene-atmosphere-moon)');
  return { moon, disc: disc.props.d as string, light: light.props.d as string };
}

function pixels(path: string): Array<[number, number]> {
  const matches = [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
  // Read the actual SVG cells, independently of the production path generator.
  expect(matches.map(match => match[0]).join('')).toBe(path);
  return matches.map(match => [Number(match[1]), Number(match[2])]);
}

describe('PixelSky rendered daylight and night branches', () => {
  it.each(['dawn', 'day', 'sunset'] as const)('renders the %s sky with clouds and a sun, without night decorations', period => {
    const renderer = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere(period)} /></svg>);
    const sky = renderer.root.findByProps({ 'data-scene-sky': period });
    expect(pathsWithFill(sky, 'sky')).toHaveLength(1);
    expect(pathsWithFill(sky, 'cloud')).toHaveLength(1);
    const sun = pathsWithFill(sky, 'sun');
    expect(sun).toHaveLength(1);
    expect(sun[0].props.d).toBe(period === 'day' ? 'M236 40h12v12h-12z' : 'M236 84h12v12h-12z');
    expect(pathsWithFill(sky, 'horizon')).toHaveLength(period === 'day' ? 0 : 1);
    if (period !== 'day') expect(pathsWithFill(sky, 'horizon')[0].props.d).toBe('M168 96h92v8h-92z');
    expect(pathsWithFill(sky, 'star')).toHaveLength(0);
    expect(sky.findAll(node => node.props['data-moon-stage'] !== undefined)).toHaveLength(0);
  });

  it('replaces the sun, clouds and horizon with stars and the current moon at night', () => {
    const renderer = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('sunset')} /></svg>);
    act(() => renderer.update(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night', 6)} /></svg>));
    const sky = renderer.root.findByProps({ 'data-scene-sky': 'night' });
    for (const variable of ['sun', 'cloud', 'horizon']) expect(pathsWithFill(sky, variable)).toHaveLength(0);
    expect(pathsWithFill(sky, 'sky')).toHaveLength(1);
    expect(pathsWithFill(sky, 'star')).toHaveLength(1);
    expect(moonPaths(sky).moon.props['data-moon-stage']).toBe(6);
  });

  it.each(['dawn', 'day', 'sunset', 'night'] as const)('clips every %s drawing to the supplied window bounds', period => {
    const renderer = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere(period)} /></svg>);
    const sky = renderer.root.findByProps({ 'data-scene-sky': period });
    const clip = sky.findByType('clipPath');
    expect(clip.findByType('rect').props).toEqual(windowBounds);
    const content = sky.find(node => node.type === 'g' && node.props.clipPath === `url(#${clip.props.id})`);
    const allPaths = sky.findAllByType('path');
    expect(allPaths.length).toBeGreaterThan(1);
    expect(content.findAllByType('path')).toEqual(allPaths);
    expect(pathsWithFill(content, 'sky')[0].props.d).toBe('M168 32h92v72h-92z');
  });
});

describe('PixelSky rendered moon geometry', () => {
  it('draws an unlit new moon and a fully lit full moon over the same disc', () => {
    const renderer = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night', 0)} /></svg>);
    const newMoon = moonPaths(renderer.root);
    expect(pixels(newMoon.disc).length).toBeGreaterThan(0);
    expect(newMoon.light).toBe('');
    act(() => renderer.update(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night', 4)} /></svg>));
    const fullMoon = moonPaths(renderer.root);
    expect(fullMoon.disc).toBe(newMoon.disc);
    expect(fullMoon.light).toBe(fullMoon.disc);
  });

  it('renders waxing light on the right and mirrored waning light on the left', () => {
    const renderer = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night', 1)} /></svg>);
    const stages = new Map<number, Array<[number, number]>>();
    let disc = '';
    for (let stage = 0; stage < 8; stage += 1) {
      act(() => renderer.update(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night', stage)} /></svg>));
      const current = moonPaths(renderer.root);
      if (stage === 0) disc = current.disc;
      expect(current.disc).toBe(disc);
      const discPixels = new Set(pixels(current.disc).map(([x, y]) => `${x},${y}`));
      const litPixels = pixels(current.light);
      expect(litPixels.every(([x, y]) => discPixels.has(`${x},${y}`))).toBe(true);
      expect(new Set(litPixels.map(([x, y]) => `${x},${y}`)).size).toBe(litPixels.length);
      stages.set(stage, litPixels);
    }
    const halfDisc = pixels(disc).length / 2;
    expect(stages.get(1)!.length).toBeGreaterThan(0);
    expect(stages.get(1)!.length).toBeLessThan(halfDisc);
    expect(stages.get(2)!).toHaveLength(halfDisc);
    expect(stages.get(3)!.length).toBeGreaterThan(halfDisc);
    expect(stages.get(3)!.length).toBeLessThan(pixels(disc).length);
    expect(stages.get(2)!.every(([x]) => x >= 6)).toBe(true);
    expect(stages.get(6)!.every(([x]) => x < 6)).toBe(true);
    for (const waxing of [1, 2, 3]) {
      const mirrored = stages.get(waxing)!.map(([x, y]) => `${11 - x},${y}`).sort();
      expect(stages.get(8 - waxing)!.map(([x, y]) => `${x},${y}`).sort()).toEqual(mirrored);
    }
    expect(new Set([...stages.values()].map(cells => JSON.stringify(cells))).size).toBe(8);
  });

  it.each([{ x: 72, y: 32, width: 28, height: 72 }, windowBounds])('fits a complete moon inside a $width-pixel-wide sky', bounds => {
    const renderer = render(<svg><PixelSky {...bounds} atmosphere={atmosphere('night', 4)} /></svg>);
    const { moon, disc } = moonPaths(renderer.root);
    const transform = /^translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)$/.exec(moon.props.transform);
    expect(transform).not.toBeNull();
    const [, originX, originY, scale] = transform!.map(Number);
    for (const [x, y] of pixels(disc)) {
      expect(originX + x * scale).toBeGreaterThanOrEqual(bounds.x);
      expect(originX + (x + 1) * scale).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(originY + y * scale).toBeGreaterThanOrEqual(bounds.y);
      expect(originY + (y + 1) * scale).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it('does not assign motion or animation to the moon itself', () => {
    const renderer = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night', 3)} /></svg>);
    const { moon } = moonPaths(renderer.root);
    expect(moon.findAll(node => typeof node.type === 'string' && (
      node.props.className || node.props.style?.animation || node.props['data-scene-motion']
      || node.type === 'animate' || node.type === 'animateTransform'
    ))).toHaveLength(0);
  });
});

it('keeps separate sky clip IDs stable through atmosphere changes in simultaneous previews', () => {
  const previews = (period: HomeSkyPeriod) => <>
    {pixelStyles.map((style, index) => <HomeScene key={style} kind="study" preview
      preferences={{ style, animated: true }} atmosphere={atmosphere(period, index)} />)}
  </>;
  const renderer = render(previews('day'));
  const clipIds = () => renderer.root.findAllByType('clipPath').map(clip => clip.props.id as string);
  const initialIds = clipIds();
  expect(new Set(initialIds).size).toBe(3);
  for (const svg of renderer.root.findAllByType('svg')) {
    const id = svg.findByType('clipPath').props.id;
    expect(svg.findAll(node => node.type === 'g' && node.props.clipPath === `url(#${id})`)).toHaveLength(1);
  }
  act(() => renderer.update(previews('night')));
  expect(clipIds()).toEqual(initialIds);
  const anotherPreview = render(<svg><PixelSky {...windowBounds} atmosphere={atmosphere('night')} /></svg>);
  expect(initialIds).not.toContain(anotherPreview.root.findByType('clipPath').props.id);
});

describe('home scene atmosphere composition', () => {
  it.each(pixelStyles)('passes each period through every activity in %s without losing the selected artwork', style => {
    const renderer = render(<HomeScene kind="study" preferences={{ style, animated: false }} atmosphere={atmosphere('day')} />);
    for (const kind of ['study', 'class', 'other'] as const) {
      for (const period of ['dawn', 'day', 'sunset', 'night'] as const) {
        act(() => renderer.update(<HomeScene kind={kind} preferences={{ style, animated: false }} atmosphere={atmosphere(period, 6)} />));
        const wrapper = renderer.root.findByProps({ 'data-scene-style': style });
        expect(wrapper.props['data-scene-kind']).toBe(kind);
        expect(wrapper.props['data-scene-period']).toBe(period);
        expect(wrapper.props['data-scene-motion']).toBe('off');
        expect(wrapper.props['aria-hidden']).toBe('true');
        const artwork = wrapper.findByProps({ 'data-scene-art': style });
        const sky = artwork.findByProps({ 'data-scene-sky': period });
        expect(sky.findAllByType('clipPath')).toHaveLength(1);
        expect(pathsWithFill(sky, period === 'night' ? 'star' : 'sun')).toHaveLength(1);
        if (period === 'night') expect(moonPaths(sky).moon.props['data-moon-stage']).toBe(6);
        if (style !== 'pixel') {
          expect(artwork.findByProps({ 'data-scene-companion': style === 'pixel-cat' ? 'cat' : 'turtle' })).toBeDefined();
          expect(artwork.findByProps({ 'data-companion-backdrop': kind })).toBeDefined();
        }
        expect(wrapper.findByType('svg').props.focusable).toBe('false');
        expect(wrapper.findAllByType('image')).toHaveLength(0);
      }
    }
  });

  it.each(pixelStyles)('keeps %s moon phases independent from motion preferences and still previews', style => {
    const scene = (stage: number, animated: boolean, preview = false) => <HomeScene kind="study" preview={preview}
      preferences={{ style, animated }} atmosphere={atmosphere('night', stage)} />;
    const renderer = render(scene(0, false));
    const motion = () => renderer.root.findByProps({ 'data-scene-style': style }).props['data-scene-motion'];
    expect(motion()).toBe('off');
    expect(moonPaths(renderer.root).light).toBe('');
    act(() => renderer.update(scene(4, false)));
    const fullMoon = moonPaths(renderer.root);
    expect(fullMoon.light).toBe(fullMoon.disc);
    expect(motion()).toBe('off');
    act(() => renderer.update(scene(4, true)));
    expect(motion()).toBe('on');
    expect(moonPaths(renderer.root).light).toBe(fullMoon.light);
    act(() => renderer.update(scene(4, true, true)));
    expect(motion()).toBe('off');
    expect(moonPaths(renderer.root).light).toBe(fullMoon.light);
    expect(renderer.root.findByType('svg').props.viewBox).toBe('0 0 320 200');
    expect(renderer.root.findAllByProps({ className: 'home-scene-time-description' })).toHaveLength(0);
  });

  it.each(['cozy', 'minimal'] as const)('preserves existing %s artwork across atmosphere changes', style => {
    const renderer = render(<HomeScene kind="study" preferences={{ style, animated: true }} atmosphere={atmosphere('day')} />);
    for (const kind of ['study', 'class', 'other'] as const) {
      act(() => renderer.update(<HomeScene kind={kind} preferences={{ style, animated: true }} atmosphere={atmosphere('day')} />));
      const dayArtwork = renderer.toJSON();
      act(() => renderer.update(<HomeScene kind={kind} preferences={{ style, animated: true }} atmosphere={atmosphere('night', 4)} />));
      expect(renderer.toJSON()).toEqual(dayArtwork);
      expect(renderer.root.findByProps({ 'data-scene-style': style }).props['data-scene-period']).toBeUndefined();
      expect(renderer.root.findAll(node => node.props['data-scene-sky'] !== undefined)).toHaveLength(0);
      expect(renderer.root.findByProps({ 'data-scene-art': style })).toBeDefined();
    }
  });

  it('exposes a non-live time and approximate-moon description outside the decorative artwork', () => {
    const renderer = render(<HomeScene kind="study" atmosphere={atmosphere('night', 4)} />);
    const description = renderer.root.findByProps({ className: 'home-scene-time-description' });
    expect(description.children.join('')).toContain('夜');
    expect(description.children.join('')).toContain('満月ごろ');
    expect(description.children.join('')).toContain('月相の近似');
    expect(description.props['aria-live']).toBeUndefined();
    expect(description.props.role).not.toBe('status');
    expect(description.props.role).not.toBe('alert');
    for (let parent = description.parent; parent; parent = parent.parent) {
      expect(parent.props['aria-hidden']).not.toBe('true');
      expect(parent.props['aria-hidden']).not.toBe(true);
    }
  });
});
