import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import type { AdviceView } from '../features/weeklyPlanning/consultation/adviceView';
import { AiPlanningAdviceReview } from './AiPlanningAdviceReview';

const view = (change: Partial<AdviceView> = {}): AdviceView =>
  ({ status: 'reviewable', adviceId: 'a', adviceRevision: 1, consultationRevision: 1, optionTitles: ['毎日少しずつ'], ...change });

describe('advice adoption controls (#246 slice 3)', () => {
  it('offers adopt and decline for one proposal, and says adopting does not make a plan', () => {
    const html = renderToStaticMarkup(<AiPlanningAdviceReview advice={view()} disabled={false} onReview={() => undefined} />);
    expect(html).toContain('この助言を採用');
    expect(html).toContain('採用しない');
    expect(html).toContain('採用しても予定には入りません');
  });

  it('offers one adopt button per option, and calls back with that option and with the decline', async () => {
    const onReview = vi.fn();
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<AiPlanningAdviceReview advice={view({ optionTitles: ['毎日少しずつ', '週末にまとめて'] })} disabled={false} onReview={onReview} />); });
    const buttons = tree.root.findAllByType('button');
    expect(buttons.map(button => button.children.join(''))).toEqual(['案1「毎日少しずつ」を採用', '案2「週末にまとめて」を採用', '採用しない']);
    await act(async () => { buttons[1].props.onClick(); });
    await act(async () => { buttons[2].props.onClick(); });
    expect(onReview.mock.calls).toEqual([['approve', 1], ['dismiss']]);
  });

  it('disables every control while the conversation is busy', () => {
    const html = renderToStaticMarkup(<AiPlanningAdviceReview advice={view()} disabled onReview={() => undefined} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('shows adopted advice as not yet a plan, and withdrawn advice as removed, with no buttons', () => {
    const adopted = renderToStaticMarkup(<AiPlanningAdviceReview advice={view({ status: 'approved' })} disabled={false} onReview={() => undefined} />);
    expect(adopted).toContain('予定にはまだ入っていません');
    const withdrawn = renderToStaticMarkup(<AiPlanningAdviceReview advice={view({ status: 'withdrawn', optionTitles: [] })} disabled={false} onReview={() => undefined} />);
    expect(withdrawn).toContain('内容を消しました');
    expect(`${adopted}${withdrawn}`).not.toContain('<button');
  });
});
