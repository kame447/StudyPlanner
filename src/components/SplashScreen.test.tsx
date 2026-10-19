import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SplashScreen } from './SplashScreen';
import { RootStartupReadyProvider } from './RootStartupReadyContext';
import { StartupVideo } from './StartupVideo';

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it('uses the supplied video only for the startup splash and retains the loading landmark', () => {
  act(() => { renderer = create(<SplashScreen fixedLight />); });
  expect(renderer!.root.findByType('main').props).toMatchObject({ 'aria-label': 'アプリ起動中',
    className: 'loading-screen splash-screen splash-screen--startup-light startup-splash' });
  expect(renderer!.root.findByType(StartupVideo).props.src).toContain('laplance_blackhole_1080x1920.mp4');
  expect(renderer!.root.findByType(StartupVideo).props.poster).toContain('laplance-startup-poster.jpg');
  expect(renderer!.root.findByType('p').props.role).toBe('status');
});

it.each(['skip', 'ended', 'error'])('keeps the same dark loading surface and actual final-frame artwork after %s', event => {
  act(() => { renderer = create(<SplashScreen fixedLight canSkip={event === 'skip'} />); });
  const main = renderer!.root.findByType('main');
  act(() => {
    if (event === 'skip') renderer!.root.findByType('button').props.onClick();
    else renderer!.root.findByType('video').props[event === 'ended' ? 'onEnded' : 'onError']();
  });
  expect(renderer!.root.findByType('main')).toBe(main);
  expect(main.props.className).toContain('startup-splash');
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(renderer!.root.findByType('img').props).toMatchObject({ alt: 'Laplance', className: 'startup-video__still' });
  expect(renderer!.root.findByType('img').props.src).toContain('laplance-startup-still.jpg');
  expect(renderer!.root.findByType('p').children).toEqual([event === 'skip' ? '準備できました' : 'アプリを準備しています...']);
});

it('uses final-frame artwork without mounting video for reduced motion', () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  act(() => { renderer = create(<SplashScreen fixedLight />); });
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(renderer!.root.findByType('img').props.alt).toBe('Laplance');
});

it('does not mount a second video inside an already root-owned startup', () => {
  const onReady = vi.fn();
  act(() => {
    renderer = create(<>
      <div style={{ display: 'none' }}>
        <RootStartupReadyProvider onReady={onReady}><SplashScreen fixedLight /></RootStartupReadyProvider>
      </div>
      <SplashScreen fixedLight canSkip />
    </>);
  });
  expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(2);
  expect(renderer!.root.findAllByType('video')).toHaveLength(1);
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(onReady).not.toHaveBeenCalled();
});

it('keeps ordinary lazy-route loading static and theme-compatible', () => {
  act(() => { renderer = create(<SplashScreen />); });
  expect(renderer!.root.findAllByType(StartupVideo)).toHaveLength(0);
  expect(renderer!.root.findByType('main').props.className).toBe('loading-screen splash-screen');
  expect(renderer!.root.findByType('img').props.src).toBe('/icons/laplans-192.png');
  expect(renderer!.root.findByProps({ className: 'brand-lockup' }).props['aria-label']).toBe('Laplance');
});

it('preserves the approved Laplance video and its extracted fallback frames', () => {
  const checksums = {
    'laplance_blackhole_1080x1920.mp4': '30dc9f0d5bab2552168a021bb217f4b00bd34db3ae7053ba7e046d9711c0caa6',
    'laplance-startup-poster.jpg': '6c9ddedfe618efe5f79c1a84158e62d6457c6ddca419b018b0ec13d727ed291a',
    'laplance-startup-still.jpg': 'c25e1c9b70f72375c3fb1d16df3733ff4e763bff7b7c182a292385660fadefa3'};
  for (const [name, expected] of Object.entries(checksums)) {
    const bytes = readFileSync(new URL(`../assets/${name}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(expected);
  }
});
