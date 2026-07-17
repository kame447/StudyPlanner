from pathlib import Path

ROOT = Path('.')
VERIFIED_SHA = '2af1a5ed8af181a1d7e847e72a44a9a1626249d9'
RUN_ID = '29582279740'


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


active = ROOT / 'docs/ai/tasks/20260714-weekly-planning-dialogue-stack-verification.md'
closed = ROOT / 'docs/ai/tasks/closed/20260714-weekly-planning-dialogue-stack-verification.md'
closed.write_text(f'''# 週間計画 dialogue stack 現行main検証完了記録

Status: closed / completed
Completed: 2026-07-17
Verified main commit: `{VERIFIED_SHA}`
GitHub Actions run: `{RUN_ID}`
Temporary verification PRs: #28, #29（いずれもmergeせずclosed）

## 1. 検証方針

production codeとtest codeを変更せず、PRのbase SHAをcheckoutしてcurrent `main`を検証した。

次を区別して記録する。

- module implemented
- production connected
- automated verified
- browser verified
- known failure
- not verified

## 2. 自動検証結果

GitHub Actions run `{RUN_ID}`で、checkout SHAが`{VERIFIED_SHA}`であることを確認した。

- targeted dialogue-stack tests: 48 files passed、1 skipped / 423 tests passed、1 skipped
- full test suite: 109 files passed、1 skipped / 1118 tests passed、13 skipped、5 todo
- TypeScript `npx tsc --noEmit`: passed
- production build: passed
- `git diff --check`: passed

buildには既知のwarningが残る。

- `naturalLanguageCatalog.ts`のdynamic/static import重複
- minified main chunkが500kB超

runの最終clean判定だけは、初版workflowが検証ログをworking tree直下へ生成したため自分のartifactをuntrackedとして検出した。tracked source/testの差分や上記検証の失敗ではない。修正版workflowはrunner tempへ出力するよう修正したが、GitHub App経由の後続PRイベントではActions runが生成されなかったため、clean-tree再測定とbuilt HTTP smokeは`not verified`として扱う。

## 3. production entrypoint静的確認

### 3.1 session / turn / preview ownership

`App.tsx`が`useWeeklyPlanningState`を所有し、turn開始時に`requestId`、`weekStartDate`、`baseRevision`を生成する。`commit_turn`でassistant message、intake state、preview candidateを一回のReducer mutationへ渡す。

modal closeは`QuickEntryModal`の表示stateだけを閉じる。active PromiseとPlanningStateは`App`側に残るため、presentation unmountだけではrequestをcancelしない構造になっている。

結果はReducerのrequest/week/revision guardを通り、selected weekまたはrevisionが変わった旧resultはcommitされない。

分類:

- module implemented: yes
- production connected: yes / partial
- automated verified: yes
- browser verified: no

partialの理由は、request envelopeにconversation IDとturn IDがなく、explicit cancellation UI/controllerが未接続であるため。

### 3.2 session persistence / reload

`useWeeklyPlanningState`がuser/week単位でload/saveする。storage boundaryはmessages、intake、preview candidates、draft blocksをclosed validatorで検証し、load/save時に`pendingTurn`、`pendingApproval`、session-only proposal recordsを除去する。

分類:

- module implemented: yes
- production connected: yes
- automated verified: yes
- browser reload verified: no

### 3.3 preview / approval

preview candidateはPlanningStateで所有され、個別削除、全破棄、draft昇格をReducerへ接続している。approvalは保存開始前にpreview metadata、revision、assumption dependency、authorized userを検証し、`sourceDraftBlockId`で同一browser内のduplicateを抑止する。

分類:

- module implemented: yes
- production connected: yes
- automated verified: yes
- browser retry / multi-tab / multi-device verified: no

### 3.4 keyboard / focus

週間計画textareaには`onKeyDown`、composition guard、input ref/focus restorationがない。送信はbutton clickのみである。

分類:

- Enter改行: browser defaultとして残るがcontract testなし
- Ctrl/Meta+Enter送信: not implemented
- IME送信抑止: not implemented
- 完了/失敗後focus復元: not implemented
- button/keyboard同時発火防止: keyboard経路未接続

これらは既存`20260716-weekly-planning-entrypoint-request-ownership.md`のUI policy受け入れ条件に一致するため、新規重複taskは作らない。

### 3.5 clear conversation / reset / explicit cancel

Reducerでは`clear_conversation`と`reset_session`を分離している。production UIからは`reset_session`が接続される一方、履歴だけを消す`clear_conversation`とactive requestのexplicit cancel操作は未接続である。

pending turn/approval中はReducerがnon-terminal mutationを拒否するため、active request中のresetやdraft mutationは現在実行できない。

## 4. browser verification

repositoryにPlaywright/Puppeteer等のbrowser automation基盤はなく、認証・access gateを含む対話操作をGitHub Actionsで自動化できない。

次は`not verified`として既存entrypoint ownership taskへ引き継ぐ。

- pending中にmodalを閉じ、完了後にreopenしてmessages/intake/previewを確認
- selected week変更、reset、explicit cancel後のstale result非適用
- IME composition
- Enter / Ctrl+Enter / Meta+Enter
- 完了・失敗後focus
- retry時の新しいconversation/turn/request identity

Cloudflare Pages deployは成功しているが、deploy成功をbrowser roleplay成功とは扱わない。

## 5. 完了判定

本taskの目的であるcurrent mainの再分類は完了した。

- 自動検証: passed
- production entrypoint: session/preview/storage/approvalは接続済み
- request ownership: partial
- keyboard/focus/explicit cancel:未接続
- browser roleplay: not verified
- production/testコードの変更: none

未接続事項は依存先`20260716-weekly-planning-entrypoint-request-ownership.md`へ統合し、そこでcharacterization testを追加して実装する。
''', encoding='utf-8')
active.unlink()

contract_path = ROOT / 'docs/ai/weekly-planning-current-contract-status.md'
contract = contract_path.read_text(encoding='utf-8')
contract = replace_once(contract,
    'Current main merge baseline: `10c40296dc6655343d4d36d04ceb63abb9c07f8e`',
    f'Current main verified baseline: `{VERIFIED_SHA}`',
    'contract baseline')
contract = replace_once(contract,
    'PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\n',
    'PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\n'
    'Current main verification: [20260714-weekly-planning-dialogue-stack-verification.md](tasks/closed/20260714-weekly-planning-dialogue-stack-verification.md)\n',
    'contract verification link')
contract = replace_once(contract,
    'architecture、verification task、roleplay planに残る「closeまたはpresentation unmountだけでactive requestを無効化する」という記述はcurrent contractではない。',
    f'''architecture、roleplay planに残る「closeまたはpresentation unmountだけでactive requestを無効化する」という記述はcurrent contractではない。

Current main `{VERIFIED_SHA[:7]}`に対するGitHub Actions run `{RUN_ID}`では、targeted 423 tests、full 1118 tests、TypeScript、production build、diff checkが成功した。静的確認ではsession/preview/storage/approvalはproduction接続済みである。一方、request envelopeのconversation/turn identity、explicit cancel、clear-conversation UI、Ctrl/Meta+Enter、IME guard、focus restorationは未接続であり、entrypoint ownership taskで実装する。browser roleplayは未検証である。''',
    'contract verification status')
contract_path.write_text(contract, encoding='utf-8')

roadmap_path = ROOT / 'docs/ai/strategy/weekly-planning-roadmap.md'
roadmap = roadmap_path.read_text(encoding='utf-8')
roadmap = replace_once(roadmap,
    '- PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](../tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\n',
    '- PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](../tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\n'
    '- Current main verification: [20260714-weekly-planning-dialogue-stack-verification.md](../tasks/closed/20260714-weekly-planning-dialogue-stack-verification.md)\n',
    'roadmap verification link')
roadmap = replace_once(roadmap,
    '検証済みworktreeからhelperを除去して実装commitを作成し、最終branch headのCloudflare Pages deployも成功した。automated verifiedであり、browser verifiedを意味しない。\n\n## 2. Implemented modules and contracts on `main`',
    f'''検証済みworktreeからhelperを除去して実装commitを作成し、最終branch headのCloudflare Pages deployも成功した。automated verifiedであり、browser verifiedを意味しない。

### 1.5 Current main dialogue-stack verification

`main` `{VERIFIED_SHA[:7]}`をGitHub Actions run `{RUN_ID}`で再検証した。

- targeted dialogue-stack tests: 48 files / 423 tests passed、1 file / 1 test skipped
- full tests: 109 files / 1118 tests passed、1 file / 13 tests skipped、5 todo
- TypeScript: passed
- production build: passed
- diff check: passed

production entrypointの静的確認ではsession/preview/storage/approvalは接続済みである。request ownershipはpartialであり、conversation/turn identity、explicit cancel、clear-conversation UI、keyboard/IME/focusは未接続である。browser roleplayは未検証であり、entrypoint ownership taskへ引き継ぐ。

## 2. Implemented modules and contracts on `main`''',
    'roadmap main verification')
roadmap = replace_between(roadmap,
    '### P0\n',
    '### P1\n',
    '',
    'roadmap remove P0')
for old, new in [
    ('2. `20260716-weekly-planning-entrypoint-request-ownership.md`', '1. `20260716-weekly-planning-entrypoint-request-ownership.md`'),
    ('3. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`', '2. `20260716-weekly-planning-trace-privacy-and-lifecycle.md`'),
    ('4. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`', '3. `20260716-weekly-planning-longitudinal-personalization-data-governance.md`'),
    ('5. `20260716-weekly-planning-approval-persistence-and-idempotency.md`', '4. `20260716-weekly-planning-approval-persistence-and-idempotency.md`'),
    ('6. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`', '5. `20260716-weekly-planning-trace-scalability-and-schema-migration.md`'),
    ('7. `20260716-weekly-planning-controller-ui-responsibility-split.md`', '6. `20260716-weekly-planning-controller-ui-responsibility-split.md`'),
]:
    roadmap = replace_once(roadmap, old, new, f'roadmap renumber {old[:2]}')
roadmap_path.write_text(roadmap, encoding='utf-8')

post_path = ROOT / 'docs/ai/weekly-planning-pr5-post-merge-status.md'
post = post_path.read_text(encoding='utf-8')
post = replace_between(post,
    '### P0-2. merge後`main`の再検証\n',
    '### P0-3. browser interaction\n',
    f'''### P0-2. merge後`main`の再検証 — completed

Current main `{VERIFIED_SHA[:7]}`をGitHub Actions run `{RUN_ID}`で再検証した。

- targeted dialogue-stack tests: 48 files / 423 tests passed、1 file / 1 test skipped
- full tests: 109 files / 1118 tests passed、1 file / 13 tests skipped、5 todo
- TypeScript: passed
- production build: passed
- diff check: passed

静的確認ではsession、preview、storage、approvalはproduction接続済みである。request ownershipはpartialであり、conversation/turn identity、explicit cancel、clear-conversation UI、keyboard/IME/focusは未接続である。

''',
    'post verification completed')
post = replace_once(post,
    '### P0-3. browser interaction',
    '### P0-3. browser interaction — not verified / P1へ引継ぎ',
    'post browser heading')
post_path.write_text(post, encoding='utf-8')

roleplay_path = ROOT / 'docs/testing/weekly-planning-roleplay-status.md'
roleplay = roleplay_path.read_text(encoding='utf-8')
roleplay = replace_once(roleplay,
    '| PR #5 conversation/session hardening | yes | `main`へmerge | 104 files / 1003 tests recorded on PR head | not complete | close-resume、storage、range、dialogue hardening |',
    '| PR #5 conversation/session hardening | yes | `main`へmerge | current main: targeted 423 / full 1118 tests passed | not complete | close-resumeのbrowser操作は未検証 |',
    'roleplay PR5 row')
roleplay = replace_once(roleplay,
    '| session-owned preview lifecycle | yes | App/session pathへ接続 | reducer/property/component tests recorded | not complete | modal close後のreopenをbrowser確認する |',
    '| session-owned preview lifecycle | yes | App/session pathへ接続 | current main targeted/full tests passed | not complete | modal close後のreopenをbrowser確認する |',
    'roleplay preview row')
roleplay = replace_once(roleplay,
    '| closed storage validation | yes | localStorage load/save pathへ接続 | v2/legacy/malformed round-trip tests recorded | not complete | merge後main再実行待ち |',
    '| closed storage validation | yes | localStorage load/save pathへ接続 | current main targeted/full tests passed | not complete | browser reload操作は未検証 |',
    'roleplay storage row')
roleplay = replace_once(roleplay,
    '| approval | yes | `App.tsx` approval path connected | tests recorded | retry scenario not complete | persistent multi-device idempotencyは別task |',
    '| approval | yes | `App.tsx` approval path connected | current main targeted/full tests passed | retry scenario not complete | persistent multi-device idempotencyは別task |',
    'roleplay approval row')
roleplay = replace_once(roleplay,
    '| DA2 | yes | partial / PR #5 ownership path connected | module/property/component tests recorded | not complete | controller統一、IME、focus、reset/cancel |',
    '| DA2 | yes | partial / App owns current request envelope | current main targeted/full tests passed | not complete | conversation/turn identity、explicit cancel、clear UI、IME、focus |',
    'roleplay DA2 row')
roleplay = replace_between(roleplay,
    '## 4. Current verification queue\n',
    '## 5. 必須browser scenario\n',
    '''## 4. Current implementation queue

1. `docs/ai/tasks/20260716-weekly-planning-entrypoint-request-ownership.md`
   - production request ownerをcontrollerへ統一し、conversation/turn identity、explicit cancel、clear UI、keyboard/IME/focusを実装する。

''',
    'roleplay queue')
roleplay_path.write_text(roleplay, encoding='utf-8')

ownership_path = ROOT / 'docs/ai/tasks/20260716-weekly-planning-entrypoint-request-ownership.md'
ownership = ownership_path.read_text(encoding='utf-8')
ownership = replace_once(ownership,
    '## 3. 目的\n',
    f'''## 3. Current main verification findings

Current main `{VERIFIED_SHA[:7]}`の検証で次を確認した。

- `App.tsx`がPlanningStateとactive Promiseを所有し、request ID、selected week、base revisionを生成する。
- modal closeは表示stateだけを閉じるため、presentation unmountだけではrequestをcancelしない。
- `commit_turn`はassistant message、intake、preview candidatesをatomicにReducerへ渡す。
- Reducerはrequest/week/revision mismatchとpending中のnon-terminal mutationを拒否する。
- storageはmessages、intake、preview、draftを保持し、pending turn/approvalをload時にsanitizeする。
- request envelopeにconversation IDとturn IDがない。
- production UIにexplicit cancellationと履歴だけを消す`clear_conversation`が接続されていない。
- 週間計画textareaにCtrl/Meta+Enter、IME guard、focus restorationがない。
- targeted 423 tests、full 1118 tests、TypeScript、buildはpassed。browser roleplayは未検証。

このtaskでは、既存のclose-resume構造を壊さず、未接続責務だけをcontrollerへ移す。

## 4. 目的
''',
    'ownership findings')
for number in range(4, 9):
    ownership = ownership.replace(f'## {number}. ', f'## {number + 1}. ', 1)
ownership_path.write_text(ownership, encoding='utf-8')
