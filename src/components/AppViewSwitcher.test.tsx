import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppViewSwitcher } from './AppViewSwitcher';

describe('AppViewSwitcher', () => {
  it('renders every app view and marks only the selected view active', () => {
    const html = renderToStaticMarkup(
      <AppViewSwitcher viewMode="week" onChange={vi.fn()} />,
    );

    for (const label of ['月', '週', '日', 'Todo', 'レポート', '時間割', '本棚']) {
      expect(html).toContain(`>${label}</button>`);
    }

    expect(html.match(/class="segment active"/g)).toHaveLength(1);
  });
});
