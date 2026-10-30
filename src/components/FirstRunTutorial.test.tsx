import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { FirstRunTutorial } from './FirstRunTutorial';

let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

function textOf(node: { children: (string | number | any)[] }): string {
  return node.children.map(child => typeof child === 'object' ? textOf(child) : String(child)).join('');
}
function click(label: string) {
  const button = renderer!.root.findAllByType('button').find(node => textOf(node).includes(label));
  expect(button, `missing ${label}`).toBeDefined();
  act(() => button!.props.onClick());
}
function heading() { return textOf(renderer!.root.findByType('h1')); }

it('explains the complete learning loop before asking for any action, with back navigation and skip', () => {
  const onFinish = vi.fn();
  const onOpenAiPlanning = vi.fn();
  act(() => { renderer = create(<FirstRunTutorial onFinish={onFinish} onOpenAiPlanning={onOpenAiPlanning} />); });
  expect(heading()).toBe('勉強を、続けられる形に。');
  for (const title of ['目標も、毎日の予定も。', '予定どおりじゃなくてもいい。', '計画と実際を、見比べる。', '今日、全部決めなくて大丈夫。']) {
    click('次へ');
    expect(heading()).toBe(title);
    expect(onFinish).not.toHaveBeenCalled();
    expect(onOpenAiPlanning).not.toHaveBeenCalled();
  }
  click('戻る');
  expect(heading()).toBe('計画と実際を、見比べる。');
  click('次へ');
  click('ホームを見る');
  expect(onFinish).toHaveBeenCalledOnce();
  expect(onOpenAiPlanning).not.toHaveBeenCalled();
});

it('supports skipping at the start and optionally opening AI planning at the end', () => {
  const onFinish = vi.fn();
  const onOpenAiPlanning = vi.fn();
  act(() => { renderer = create(<FirstRunTutorial onFinish={onFinish} onOpenAiPlanning={onOpenAiPlanning} />); });
  click('スキップ');
  expect(onFinish).toHaveBeenCalledOnce();
  for (let i = 0; i < 4; i++) click('次へ');
  click('AIと計画を考える');
  expect(onOpenAiPlanning).toHaveBeenCalledOnce();
});

it('lets users swipe across slides and ignores accidental short touch gestures', () => {
  act(() => { renderer = create(<FirstRunTutorial onFinish={() => {}} onOpenAiPlanning={() => {}} />); });
  const main = renderer!.root.findByProps({ className: 'first-run-tour-main' });
  act(() => {
    main.props.onTouchStart({ touches: [{ clientX: 210 }] });
    main.props.onTouchEnd({ changedTouches: [{ clientX: 185 }] });
  });
  expect(heading()).toBe('勉強を、続けられる形に。');
  act(() => {
    main.props.onTouchStart({ touches: [{ clientX: 210 }] });
    main.props.onTouchEnd({ changedTouches: [{ clientX: 90 }] });
  });
  expect(heading()).toBe('目標も、毎日の予定も。');
  act(() => {
    main.props.onTouchStart({ touches: [{ clientX: 90 }] });
    main.props.onTouchEnd({ changedTouches: [{ clientX: 210 }] });
  });
  expect(heading()).toBe('勉強を、続けられる形に。');
});
