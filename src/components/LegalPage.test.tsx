import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalPage } from './LegalPage';

describe('account deletion disclosures', () => {
  it.each(['terms', 'privacy'] as const)('explains the in-app flow and contact fallback on %s', (kind) => {
    const html = renderToStaticMarkup(<LegalPage kind={kind} />);
    expect(html).toContain('設定の「退会する」');
    expect(html).toContain('再認証');
    expect(html).toContain('削除は取り消せません');
    expect(html).toContain('ログインできない');
    expect(html).toContain('お問い合わせページ');
  });

  it('discloses retained records without promising that every identifier expires in 24 hours', () => {
    const html = renderToStaticMarkup(<LegalPage kind="privacy" />);
    expect(html).toContain('180日間');
    expect(html).toContain('本文やAI出力を受付から最大24時間で消去');
    expect(html).toContain('期限を定めず保持');
    expect(html).toContain('現在、自動削除の期限を設けていません');
    expect(html).toContain('同じ画面から再試行');
    expect(html).toContain('別端末のブラウザ内');
  });
});
