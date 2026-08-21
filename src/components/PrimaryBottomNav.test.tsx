import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PrimaryBottomNav } from './PrimaryBottomNav';

const navigation = {
  onOpenAiPlanning: vi.fn(),
  onOpenSchedule: vi.fn(),
  onOpenHome: vi.fn(),
  onOpenBookshelf: vi.fn(),
  onOpenReport: vi.fn(),
};

describe('PrimaryBottomNav', () => {
  it('renders one shared five-item navigation and marks exactly one item active', () => {
    const html = renderToStaticMarkup(
      <PrimaryBottomNav active="bookshelf" {...navigation} />,
    );

    for (const label of ['AI計画', '予定', 'ホーム', '教材', '時間割']) {
      expect(html).toContain(label);
    }

    expect(html.match(/class="active"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('primary-bottom-nav');
  });
});