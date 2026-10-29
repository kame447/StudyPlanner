import { readFileSync } from 'node:fs';
import { create, act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { RouteSkeleton } from './RouteSkeleton';

const views = ['month', 'week', 'day', 'todo', 'bookshelf', 'report', 'timetable', 'ai-planning', 'contact'] as const;
describe('route loading presentation', () => {
  it.each(views)('%s exposes one loading status outside the busy region without interactive controls', view => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<RouteSkeleton view={view} />); });
    expect(renderer.root.findByType('section').props['aria-busy']).toBe(true);
    expect(renderer.root.findByType('section').props['aria-label']).toContain('読み込み中');
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(1);
    expect(renderer.root.findByType('section').findAllByProps({ role: 'status' })).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('読み込んでいます');
    expect(renderer.root.findByProps({ className: 'route-skeleton__layout' }).props['aria-hidden']).toBe(true);
    expect(renderer.root.findAll(node => ['button', 'input', 'a', 'textarea', 'main'].includes(String(node.type)))).toHaveLength(0);
    expect(renderer.root.findByType('section').props.className).toBe(`route-skeleton route-skeleton--${view}`);
    act(() => renderer.unmount());
  });
  it('reserves different calendar, card, report, form and conversation layouts', () => {
    const expected = { month: 'calendar', week: 'calendar', timetable: 'calendar', day: 'list', todo: 'list', bookshelf: 'books', report: 'chart', contact: 'input', 'ai-planning': 'composer' } as const;
    for (const view of views) {
      let renderer!: ReturnType<typeof create>;
      act(() => { renderer = create(<RouteSkeleton view={view} />); });
      expect(renderer.root.findAll(node => typeof node.type === 'string' && node.props.className?.split(' ').includes(`route-skeleton__${expected[view]}`))).toHaveLength(1);
      act(() => renderer.unmount());
    }
  });
  it('uses static theme tokens, including reduced-motion users, without a viewport-sized splash', () => {
    const css = readFileSync(new URL('./RouteSkeleton.css', import.meta.url), 'utf8');
    expect(css).toContain('var(--surface)');
    expect(css).toContain('var(--border)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).not.toMatch(/animation\s*:|transition\s*:|@keyframes|100vh|#fff/);
  });
  it('keeps route fallback selection separate from startup, auth and data ownership', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('fallback={<RouteSkeleton view={viewMode} />}');
    expect(app).toContain('isAiPlanningSurface ? <RouteSkeleton view="ai-planning" /> : null');
    expect(app).toContain('return <SplashScreen fixedLight />');
    for (const [name, view] of [['Month', 'month'], ['Day', 'day'], ['Bookshelf', 'bookshelf'], ['Report', 'report'], ['Timetable', 'timetable']]) {
      const source = readFileSync(new URL(`./Deferred${name}View.tsx`, import.meta.url), 'utf8');
      expect(source).toContain(`fallback={<RouteSkeleton view="${view}" />}`);
      expect(source).toContain('role="alert"');
    }
  });
});
