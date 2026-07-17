from pathlib import Path

ROOT = Path('.')
MERGE_SHA = '10c40296dc6655343d4d36d04ceb63abb9c07f8e'
RUN_ID = '29581399006'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    end_index = text.find(end, start_index + len(start))
    if start_index < 0 or end_index < 0:
        raise SystemExit(f'{label}: markers not found')
    return text[:start_index] + replacement + text[end_index:]


active_task = ROOT / 'docs/ai/tasks/20260717-weekly-planning-kanji-absolute-date-guard.md'
closed_task = ROOT / 'docs/ai/tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md'
closed_task.write_text(f'''# 週間計画で漢数字の絶対日付を曜日として誤解釈しない

Status: closed / completed
Priority: P0
Created: 2026-07-17
Completed: 2026-07-17
Related Issue: #21
Related Pull Request: #26
Main merge commit: `{MERGE_SHA}`
GitHub Actions run: `{RUN_ID}`
Parent status: `docs/ai/weekly-planning-pr5-post-merge-status.md`

## 1. 完了した契約

- `8月1日`、`8月一日`、`八月1日`、`八月一日`を同じ絶対日付tokenとして扱う。
- selected dateを基準に年を解決し、実行時current dateで上書きしない。
- 絶対日付token内の`日`を曜日候補から除外する。
- 無効な絶対日付またはpending range外の日付を、範囲内の日曜日へfallbackしない。
- `日曜日から`、`日曜から`、`来週の日曜日から`の曜日解決を維持する。
- `一日だけ`、`一週間`等を月日または日曜日として誤認しない。
- deterministic parserとAI candidate validatorを同じ絶対日付guardへ接続する。

## 2. 実装

- `weeklyPlanningAbsoluteDate.ts`へ月日tokenization、漢数字解決、selected date基準の年解決、candidate整合性判定を分離した。
- `weeklyPlanningScopeParsing.ts`で絶対日付tokenを曜日抽出より先に処理し、解決失敗時の曜日fallbackを禁止した。
- pending rangeの開始回答では、範囲内の絶対日付だけを採用する。
- `weeklyPlanningCandidateValidator.ts`でAIの`set_planning_range`がsource textの絶対日付と一致することを検証する。
- intake pipelineからcandidate validatorへ`WeeklyPlanningIntakeContext`を渡す。
- parser、candidate、pipelineを含むfocused regressionを19件追加した。

## 3. 検証

GitHub Actions run `{RUN_ID}`で、実装適用後のworktreeを対象に次を実行し、すべて成功した。

- `npm ci`
- `git diff --check`
- focused regression: 19 passed
- `src/features/weeklyPlanning` suite
- 全テスト `npm run test:run`
- production build `npm run build`

同runが検証済みworktreeからhelperを除去し、実装commitをbranchへpushした。最終branch headのCloudflare Pages deployも成功した。

## 4. 対象外

- account-linked week-start profile
- genericな日本語数詞parser
- preview lifecycle
- approval persistence
- trace privacy
- browser roleplay全体
''', encoding='utf-8')
active_task.unlink()

contract_path = ROOT / 'docs/ai/weekly-planning-current-contract-status.md'
contract = contract_path.read_text(encoding='utf-8')
contract = replace_once(
    contract,
    'Current main merge baseline: `bb39e968d7b4923a159a11380fe914d8ed2eb5e7`',
    f'Current main merge baseline: `{MERGE_SHA}`',
    'contract baseline',
)
contract = replace_once(
    contract,
    '- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\n',
    '- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\n'
    '- PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\n',
    'contract completion link',
)
contract = replace_once(
    contract,
    '既知の機能バグとして、漢数字を含む絶対日付の`日`を日曜日として誤解釈する可能性がある。Issue #21と`20260717-weekly-planning-kanji-absolute-date-guard.md`をP0として扱う。',
    'PR #26で、算用数字・漢数字・混在表記の月日を共通tokenizerへ通し、絶対日付token内の`日`を曜日へfallbackしない契約を実装した。deterministic parserとAI candidate validatorは同じselected-date基準のguardを使用する。Issue #21は完了済みであり、残課題はaccount-linked week-start profileとbrowser roleplayである。',
    'contract issue status',
)
contract_path.write_text(contract, encoding='utf-8')

roadmap_path = ROOT / 'docs/ai/strategy/weekly-planning-roadmap.md'
roadmap = roadmap_path.read_text(encoding='utf-8')
roadmap = replace_once(
    roadmap,
    'Current main baseline: `bb39e968d7b4923a159a11380fe914d8ed2eb5e7`',
    f'Current main baseline: `{MERGE_SHA}`',
    'roadmap baseline',
)
roadmap = replace_once(
    roadmap,
    '- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](../tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\n',
    '- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](../tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\n'
    '- PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](../tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\n',
    'roadmap completion link',
)
roadmap = replace_once(
    roadmap,
    '一時検証workflowは検証後に削除した。Cloudflare Pages deployもsquash merge前の最終branch headで成功した。これはautomated verifiedを意味するが、browser verifiedまたは自然言語入力の完全網羅を意味しない。\n\n## 2. Implemented modules and contracts on `main`',
    f'''一時検証workflowは検証後に削除した。Cloudflare Pages deployもsquash merge前の最終branch headで成功した。これはautomated verifiedを意味するが、browser verifiedまたは自然言語入力の完全網羅を意味しない。

### 1.4 PR #26 recorded validation

PR #26は2026-07-17にsquash mergeされ、`main` merge commitは`{MERGE_SHA[:7]}`である。Issue #21の漢数字絶対日付と曜日の誤認を修正した。

GitHub Actions run `{RUN_ID}`で実装適用後のworktreeを対象に次を実行し、すべて成功した。

- `npm ci`: passed
- `git diff --check`: passed
- focused regression: 19 passed
- `src/features/weeklyPlanning` suite: passed
- full tests: passed
- production build: passed

検証済みworktreeからhelperを除去して実装commitを作成し、最終branch headのCloudflare Pages deployも成功した。automated verifiedであり、browser verifiedを意味しない。

## 2. Implemented modules and contracts on `main`''',
    'roadmap PR26 validation',
)
roadmap = replace_once(
    roadmap,
    '| planning range pending contract | PR #24までmerged / automated verified | Issue #21、week-start profile、browser roleplay |',
    '| planning range pending contract | PR #26までmerged / automated verified | week-start profile、browser roleplay |',
    'roadmap planning range row',
)
roadmap = replace_between(
    roadmap,
    '### P0\n',
    '### P1\n',
    '''### P0

1. `20260714-weekly-planning-dialogue-stack-verification.md`
   - current `main`でtargeted tests、TypeScript、build、full tests、production entrypoint、browser behaviorを再分類する。
   - PR #5のclose-resume契約、session reset/stale契約、IME、focusを分けて検証する。
   - 失敗時はtask内で修正せず、原因と再現情報を別taskへ切り出す。

''',
    'roadmap P0 queue',
)
for old, new in [
    ('3. `20260716-weekly-planning-entrypoint-request-ownership.md`', '2. `20260716-weekly-planning-entrypoint-request-ownership.md`'),
    ('4. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`', '3. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`'),
    ('5. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`', '4. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`'),
    ('6. `20260716-weekly-planning-approval-persistence-and-idempotency.md`', '5. `20260716-weekly-planning-approval-persistence-and-idempotency.md`'),
    ('7. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`', '6. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`'),
    ('8. `20260716-weekly-planning-controller-ui-responsibility-split.md`', '7. `20260716-weekly-planning-controller-ui-responsibility-split.md`'),
]:
    roadmap = replace_once(roadmap, old, new, f'roadmap renumber {old[:2]}')
roadmap_path.write_text(roadmap, encoding='utf-8')

post_path = ROOT / 'docs/ai/weekly-planning-pr5-post-merge-status.md'
post = post_path.read_text(encoding='utf-8')
post = replace_once(post, 'Known functional bug: Issue `#21`', 'Resolved functional bug: Issue `#21` / PR `#26`', 'post header')
post = replace_once(
    post,
    'ただし、漢数字を含む絶対日付についてIssue #21が残る。',
    'PR #26で、算用数字・漢数字・混在表記の月日tokenizer、絶対日付token内の曜日除外、解決失敗時のfallback禁止、AI candidate整合性guardを実装した。Issue #21は完了済みである。',
    'post planning range status',
)
post = replace_between(
    post,
    '## 4. 現在確認済みの機能バグ\n',
    '## 5. 検証が未完了の項目\n',
    f'''## 4. 完了した機能バグ

### P0-1. 漢数字の絶対日付を曜日として誤解釈する

Issue #21はPR #26で完了した。

- 共通月日tokenizerで算用数字・漢数字・混在表記を扱う。
- 絶対日付token内の`日`を曜日候補から除外する。
- 無効日付またはpending range外日付を日曜日へfallbackしない。
- deterministic parserとAI candidate validatorを同じselected-date基準のguardへ通す。
- focused regression 19件、週間計画suite、全テスト、production build、diff checkがGitHub Actions run `{RUN_ID}`で成功した。

browser roleplayとweek-start profileは別taskとして残る。

''',
    'post issue section',
)
post_path.write_text(post, encoding='utf-8')

roleplay_path = ROOT / 'docs/testing/weekly-planning-roleplay-status.md'
roleplay = roleplay_path.read_text(encoding='utf-8')
roleplay = replace_once(
    roleplay,
    '| pending planning range | yes | intake pathへ接続 | focused tests recorded | not complete | Issue #21がopen、week-start profile未実装 |',
    '| pending planning range | yes | intake pathへ接続 | PR #24・#26 focused/full tests passed | not complete | Issue #21完了。week-start profileとbrowser roleplayは未実装 |',
    'roleplay range row',
)
roleplay = replace_between(
    roleplay,
    '## 4. Current verification queue\n',
    '## 5. 必須browser scenario\n',
    '''## 4. Current verification queue

1. `docs/ai/tasks/20260714-weekly-planning-dialogue-stack-verification.md`
   - current `main`でmodule、entrypoint、自動検証、browser behaviorを再分類する。
2. `docs/ai/tasks/20260716-weekly-planning-entrypoint-request-ownership.md`
   - DA2のproduction ownershipとrace/keyboard契約をcontrollerへ統一する。

''',
    'roleplay queue',
)
roleplay_path.write_text(roleplay, encoding='utf-8')
