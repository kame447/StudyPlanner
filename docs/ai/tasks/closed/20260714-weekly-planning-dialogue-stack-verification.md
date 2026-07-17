# 週間計画 dialogue stack 現行main検証完了記録

Status: closed / completed
Completed: 2026-07-17
Verified main commit: `2af1a5ed8af181a1d7e847e72a44a9a1626249d9`
GitHub Actions run: `29582279740`
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

GitHub Actions run `29582279740`で、checkout SHAが`2af1a5ed8af181a1d7e847e72a44a9a1626249d9`であることを確認した。

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
