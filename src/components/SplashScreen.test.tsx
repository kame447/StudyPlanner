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
  expect(renderer!.root.findByType(StartupVideo).props.src).toContain('laplans_blackhole_1080x1920.mp4');
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
  expect(renderer!.root.findByType('img').props.src).toContain('laplans-startup-still.jpg');
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
