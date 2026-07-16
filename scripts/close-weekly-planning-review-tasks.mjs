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

{
  const path = 'src/features/weeklyPlanning/__tests__/weeklyPlanningDialoguePathRegression.test.ts';
  const content = readFileSync(path, 'utf8');
  const before = "expect(output.behaviorDialogue.message).toContain('具体的に何をどこまで進めたいか教えてください。');";
  const after = "expect(output.behaviorDialogue.message).not.toContain('具体的に何をどこまで進めたいか教えてください。');";
  if (!content.includes(before)) throw new Error('dialogue path assertion anchor not found');
  writeFileSync(path, content.replace(before, after), 'utf8');
}

writeFileSync(
  'docs/ai/tasks/20260716-weekly-planning-conversation-hardening-rereview.md',
  [
    '# 週間計画対話改善の再確認',
    '',
    'Status: ready_for_review',
    'Created: 2026-07-16',
    '',
    '対象: PR #5',
    '',
    '## 確認対象',
    '',
    '- exam scopeの属性単位mergeと確定属性保護',
    '- AI commandの閉じたruntime validation',
    '- fixed-event occurrenceの期間・時刻・繰り返し処理',
    '- pending turn・approval・revisionのsession ownership',
    '- modal再開、reset、storage v2',
    '- preview・承認経路の回帰',
    '',
    '## 必須確認',
    '',
    '1. stale requestや別週の結果がcommitされないこと',
    '2. pending中のturn、削除、破棄、resetがstateを変更しないこと',
    '3. approval中のmutationがUIとreducer双方で拒否されること',
    '4. 保存sessionがmodal外側から週間計画として再開されること',
    '5. intake-only sessionでもresetできること',
    '6. resetが未承認draftを削除し、承認済み予定を削除しないこと',
    '7. future version・破損storageを拒否すること',
    '8. property-based testがstale identity、任意mutation列、revision単調性を検証すること',
    '',
    '結果はBLOCKER、MAJOR、MINOR、検証結果、設計上の残論点の順で報告する。確認中はコードと文書を変更しない。',
    '',
  ].join('\n'),
  'utf8',
);
