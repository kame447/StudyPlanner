import { readFileSync, writeFileSync } from 'node:fs';

for (const path of [
  'docs/ai/tasks/20260716-weekly-planning-conversation-hardening.md',
  'docs/ai/tasks/20260716-weekly-planning-conversation-hardening-review-fixes.md',
]) {
  let content = readFileSync(path, 'utf8');
  content = content.replace('Status: open', 'Status: closed');
  if (!content.includes('Closed: 2026-07-16')) {
    content = content.replace('Created: 2026-07-16', 'Created: 2026-07-16\nClosed: 2026-07-16');
  }
  content = content.replaceAll('- [ ]', '- [x]');
  content = content.replace(
    '- [x] 「履歴をクリア」操作だけが会話sessionを消す',
    '- [x] 「この週の相談をリセット」で会話、intake state、未承認draftを削除する',
  );
  writeFileSync(path, content, 'utf8');
}
