import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AppSettingsDialog } from '../AppSettingsDialog';
import { HomeScene } from './HomeScene';
import { HOME_SCENE_STYLE_OPTIONS } from '../../lib/homeScenePreferences';

function artworkGeometry(svg: ReactTestInstance): string {
  // Compare rendered drawing instructions, excluding wrapper labels and component names.
  const drawingElements = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
  const drawingAttributes = new Set(['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
    'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke', 'strokeWidth']);
  return JSON.stringify(svg.findAll(node => typeof node.type === 'string'
    && (drawingElements.has(node.type) || (node.type === 'g' && node.props.transform)))
    .map(node => ({
      element: node.type,
      attributes: Object.fromEntries(Object.entries(node.props).filter(([key]) => drawingAttributes.has(key))),
    })));
}

describe('code-rendered home artwork', () => {
  for (const style of ['pixel', 'pixel-cat', 'pixel-turtle', 'cozy', 'minimal'] as const) {
    it(`renders distinct study, class and other scenes in ${style} with no image dependency`, () => {
      const markup = new Set<string>();
      for (const kind of ['study', 'class', 'other'] as const) {
        const renderer = create(<HomeScene kind={kind} preferences={{ style, animated: true }} />);
        const scene = renderer.root.findByProps({ 'data-scene-style': style });
        expect(scene.props['aria-hidden']).toBe('true');
        expect(scene.props['data-scene-kind']).toBe(kind);
        expect(scene.props['data-scene-motion']).toBe('on');
        expect(renderer.root.findByType('svg').props.focusable).toBe('false');
        expect(renderer.root.findByType('svg').props.viewBox).toBe('64 0 256 200');
        expect(renderer.root.findByType('svg').props.preserveAspectRatio).toBe('xMaxYMax meet');
        expect(renderer.root.findAllByType('img')).toHaveLength(0);
        expect(renderer.root.findAllByType('image')).toHaveLength(0);
        expect(renderer.root.findByProps({ 'data-scene-art': style }).findAllByType('path').length).toBeGreaterThan(5);
        markup.add(artworkGeometry(renderer.root.findByType('svg')));
        renderer.unmount();
      }
      expect(markup.size).toBe(3);
    });
  }

  it.each(['study', 'class', 'other'] as const)('draws five genuinely different artworks for %s', kind => {
    const artwork = new Set<string>();
    for (const style of ['pixel', 'pixel-cat', 'pixel-turtle', 'cozy', 'minimal'] as const) {
      const renderer = create(<HomeScene kind={kind} preferences={{ style, animated: false }} />);
      artwork.add(artworkGeometry(renderer.root.findByType('svg')));
      renderer.unmount();
    }
    expect(artwork.size).toBe(5);
  });

  it('defaults to still pixel artwork and keeps previews still even when motion is requested', () => {
    const renderer = create(<HomeScene kind="study" />);
    expect(renderer.root.findByProps({ 'data-scene-style': 'pixel' }).props['data-scene-motion']).toBe('off');
    renderer.update(<HomeScene kind="study" preferences={{ style: 'cozy', animated: true }} preview />);
    expect(renderer.root.findByProps({ className: 'home-scene-preview' }).props['data-scene-motion']).toBe('off');
    expect(renderer.root.findByType('svg').props.viewBox).toBe('0 0 320 200');
    expect(renderer.root.findByType('svg').props.preserveAspectRatio).toBe('xMaxYMax meet');
    renderer.unmount();
  });

  it.each(['pixel-cat', 'pixel-turtle'] as const)('keeps %s still when motion is off or it is a settings preview', style => {
    const renderer = create(<HomeScene kind="study" preferences={{ style, animated: false }} />);
    expect(renderer.root.findByProps({ 'data-scene-style': style }).props['data-scene-motion']).toBe('off');
    renderer.update(<HomeScene kind="study" preferences={{ style, animated: true }} preview />);
    expect(renderer.root.findByProps({ 'data-scene-style': style }).props['data-scene-motion']).toBe('off');
    renderer.update(<HomeScene kind="study" preferences={{ style, animated: true }} />);
    expect(renderer.root.findByProps({ 'data-scene-style': style }).props['data-scene-motion']).toBe('on');
    renderer.unmount();
  });

  for (const companion of ['cat', 'turtle'] as const) {
    it(`keeps the ${companion} and a distinct activity backdrop across plan changes`, () => {
      const renderer = create(<HomeScene kind="study" preferences={{ style: `pixel-${companion}`, animated: true }} />);
      const backdrops = new Set<string>();
      for (const kind of ['study', 'class', 'other'] as const) {
        renderer.update(<HomeScene kind={kind} preferences={{ style: `pixel-${companion}`, animated: true }} />);
        const animal = renderer.root.findByProps({ 'data-scene-companion': companion });
        expect(animal.findAllByType('path').length).toBeGreaterThan(5);
        const movingParts = companion === 'cat'
          ? ['cat-tail', 'cat-head', 'cat-eyes']
          : ['turtle-walk', 'turtle-head', 'turtle-leg-front', 'turtle-leg-back'];
        for (const part of movingParts) {
          expect(animal.findByProps({ className: `home-scene-${part}` })).toBeDefined();
        }
        const backdrop = renderer.root.findByProps({ 'data-companion-backdrop': kind });
        backdrops.add(backdrop.findAllByType('path').map(path => path.props.d).join(' '));
      }
      expect(backdrops.size).toBe(3);
      renderer.unmount();
    });
  }
});

it('connects labeled settings to style/motion callbacks, selected state and storage errors', () => {
  const onStyle = vi.fn(); const onMotion = vi.fn();
  const props = { open: true, themeMode: 'light' as const, themePalette: 'forest' as const,
    onChangeTheme: vi.fn(), onChangeThemePalette: vi.fn(), onClose: vi.fn(),
    onChangeHomeSceneStyle: onStyle, onChangeHomeSceneMotion: onMotion };
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<AppSettingsDialog {...props} homeScenePreferences={{ style: 'cozy', animated: true }} />); });
  for (const option of HOME_SCENE_STYLE_OPTIONS) {
    const button = renderer.root.findByProps({ 'aria-label': option.label });
    expect(button.props.type).toBe('button');
    expect(button.props['aria-pressed']).toBe(option.id === 'cozy');
    act(() => button.props.onClick());
    expect(onStyle).toHaveBeenLastCalledWith(option.id);
  }
  const checkbox = renderer.root.findByProps({ type: 'checkbox' });
  expect(checkbox.props.checked).toBe(true);
  expect(checkbox.props['aria-describedby']).toBe('home-scene-motion-description');
  act(() => checkbox.props.onChange({ target: { checked: false } }));
  expect(onMotion).toHaveBeenCalledWith(false);
  act(() => renderer.update(<AppSettingsDialog {...props} homeSceneError="保存できませんでした" />));
  expect(renderer.root.findByProps({ role: 'alert' }).children).toEqual(['保存できませんでした']);
  act(() => renderer.update(<AppSettingsDialog {...props} open={false} />));
  expect(renderer.toJSON()).toBeNull();
  act(() => renderer.unmount());
});
