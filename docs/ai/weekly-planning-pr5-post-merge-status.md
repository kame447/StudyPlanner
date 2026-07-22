# weeklyPlanning PR #5 post-merge status

Status: historical / closed post-merge snapshot
Updated: 2026-07-22
Target branch: `main`
Target merge commit: `55f8e32c68cfd057494fadec0ed208cba267db12`
Related PR: `#5 feat: 週間計画の対話と履歴を改善`
Current semantic ownership is defined by `weekly-planning-current-contract-status.md` and the PR #75 completion record. This document must not be used as an active contract or queue.
Resolved functional bug: Issue `#21` / PR `#26`

## 1. この文書の役割

この文書は、PR #5が`main`へmergeされた時点で、週間計画機能に何が実装され、何が未完了で、どの順序で後続作業を進めるべきかをまとめたpost-merge statusである。

次を一つの`complete`へ丸めない。

```text
module implemented
production connected
automated verification recorded
browser verified
operationally deployed
```

product decisionは`weekly-planning-current-contract-status.md`、実装順はroadmap、scenario contractはroleplay test plan、coverageはroleplay statusを正とする。この文書はPR #5の実装事実と残課題を横断して確認するためのstatus overlayである。

## 2. 調査範囲と保証範囲

確認対象:

- PR #5本文、最終head `052d7f0`、merge commit `55f8e32`
- PR #5の変更ファイル86件
- PR review threadと後続Issue #21
- `App.tsx`
- `NaturalLanguageAssistant.tsx`
- `QuickEntryModal.tsx`
- `WeeklyPlanningConversation.tsx`
- `weeklyPlanningConversationMode.ts`
- `src/features/weeklyPlanning/`のstate、reducer、storage、turn executor、intake、dialogue、pipeline、planning関連
- current contract、roadmap、architecture、product spec、roleplay plan/status、active tasks
- `20260717-codebase-maintainability-review.md`の構造監査結果

PR #5には次の検証記録がある。

- `git diff --check origin/main...HEAD`: passed
- 104 test files passed、1 skipped
- 1003 tests passed、13 skipped、5 todo
- production build: passed
- 既知警告: dynamic/static import重複、500kB超chunk

この検証記録はPR #5最終headに対するものであり、merge後の現在`main`を別環境で再実行した結果ではない。browser roleplay、IME、focus、multi-tab、multi-device、production privacy運用は別途検証が必要である。

## 3. PR #5で`main`に入った機能

### 3.1 会話sessionの永続化と再開

- 会話messagesと週間計画intake stateを`PlanningState`へ集約した。
- draftが存在しなくても、再開すべき会話または入力済み条件があればsessionをlocalStorageへ保持する。
- 保存済みsessionがある場合、modal再表示時に週間計画画面から再開する。
- user発話、assistant応答、preview昇格、approval成功の表示元を会話履歴へ一本化した。
- 会話履歴表示とtyping indicatorを`WeeklyPlanningConversation`へ分離した。
- 初期表示modeをsession stateから導出する純粋関数を追加した。

### 3.2 pending中に画面を閉じてもpreviewを失わない

PR #5以前は、非同期で完成したpreview候補がunmount済みcomponentのlocal stateへ返り、結果が失われる経路があった。

PR #5ではpreview候補を`PlanningState`へ移し、turn ownerを上位session境界へ置いた。modalを表示上閉じたことだけではsession cancelと扱わず、request完了後にuser発話、assistant応答、preview候補をsessionへcommitし、再表示時に復元できる。

現在の意味は次である。

```text
modal close / presentation component unmount
  = 表示を閉じる。session cancelではない

session reset / selected week invalidation / explicit cancellation
  = 旧resultを現在stateへ適用しない

browser reload中の未完了network request
  = request自体は再開しない。load時に一時ownershipを除去する
```

`close`と`cancel`を同義として扱う旧task・旧scenarioはcurrent contractではない。

### 3.3 履歴クリアとsession resetの分離

- `clear_conversation`は会話履歴を対象とする。
- `reset_session`は会話、intake、preview、draft等をまとめて初期化する。
- draftやpreviewが存在する場合に、履歴クリアだけで作成済み候補を意図せず失わない契約を持つ。
- pending turnまたはpending approval中の不正なnon-terminal mutationはReducerで拒否する。

### 3.4 非同期request ownershipとrevision guard

- request ID、対象週、開始時revisionを独立して検証する。
- pending turnとpending approvalをstate上で明示する。
- request ID、対象週、revisionが一致しない結果を現在stateへ適用しない。
- pending中に許可されていないstate mutationを拒否する。
- preview approval前にstale stateとpending assumptionを再検証する。
- request/revision契約をproperty testで固定した。

### 3.5 deterministic baselineとAI semantic補完

- 明示的な日付、曜日、時刻、数値、単位、現在質問への短答、確定済み情報の保護をdeterministic責務とする。
- AIは曖昧な言い換え、複数文の関係、訂正対象、タスク種別、優先関係等を補完する。
- deterministic parserが作った部分exam scopeへ、AIが別属性を安全に補完できる。
- 確定済み属性を異なるAI候補で破壊的に上書きすることは拒否する。
- AI structured outputの任意object propertyが`null`の場合だけ未指定へcanonicalizeする。
- unknown property、必須値欠落、不正enum、不正配列を補修せずrejectする。

旧`single AI interpreter / no merge`契約はcurrent contractではない。

### 3.6 質問生成と対話品質

- 対象分野が一件ならpriority質問を省略し、その分野を自動選択する。
- 複数分野ではpriority確認を維持する。
- 計画期間内の登録済み予定を示し、追加の固定予定だけを尋ねる。
- 固定予定質問の初期例から、特定の生活事情へ寄った定型語を除いた。
- 期間開始前日から跨いで期間内へ入る単発・繰り返し予定もfixed event抽出へ含める。
- 不確実性を`explicit_repair`、`pass_over`、`continue`へ有限分類する。
- previewを止める高影響の不確実性だけを一度に一件確認する。
- safe defaultまたは有限optionがある場合は、自由質問よりproposal confirmationを優先する。
- accepted stateと直近user turnに根拠がある事項だけgrounded acknowledgementとして表示する。
- AIが生成した未根拠acknowledgementは表示しない。

### 3.7 planning range契約

- 期間名、具体的な開始日、日数を別の情報として扱う。
- `next_week`は7日へcanonicalizeする。
- 「夏休み」のような期間名だけの未来期間は、開始日・日数未確定のまま保持できる。
- 「夏休み」→「8月1日から一週間」のような複数turn補完を扱う。
- pending `来週`の候補範囲はselected dateを基準に扱い、実行時current dateで上書きしない。
- pending範囲外の明示日付を無条件に採用しない。

PR #26で、算用数字・漢数字・混在表記の月日tokenizer、絶対日付token内の曜日除外、解決失敗時のfallback禁止、AI candidate整合性guardを実装した。Issue #21は完了済みである。

### 3.8 preview lifecycle

- preview候補をcomponent-local stateではなくsession stateで所有する。
- preview候補の個別削除、全破棄、draftへの昇格を扱う。
- draft昇格時に対応preview候補を除去する。
- preview、draft、behavior metadataのstable identityとreasoning metadataを保持する。
- stale preview、pending-assumption preview、eligible previewを区別する。
- explicit UI approvalまでrepositoryへ保存しない。

### 3.9 storage boundary

- intake、draft、preview、behavior metadataを閉じたruntime validatorで検査する。
- unknown nested metadataや不正日時等を含むmalformed sessionは全体拒否する。
- v2とlegacy loadの両方を同じsanitize boundaryへ通す。
- load時に`pendingTurn`、`pendingApproval`、session内だけの`assumptionProposalRecords`を除去する。
- 保存すべきmessagesと入力済み条件は保持する。
- 正常なbehavior-aware previewと昇格済みdraftのround-tripを維持する。

## 4. 完了した機能バグ

### P0-1. 漢数字の絶対日付を曜日として誤解釈する

Issue #21はPR #26で完了した。

- 共通月日tokenizerで算用数字・漢数字・混在表記を扱う。
- 絶対日付token内の`日`を曜日候補から除外する。
- 無効日付またはpending range外日付を日曜日へfallbackしない。
- deterministic parserとAI candidate validatorを同じselected-date基準のguardへ通す。
- focused regression 19件、週間計画suite、全テスト、production build、diff checkがGitHub Actions run `29581399006`で成功した。

browser roleplayとweek-start profileは別taskとして残る。

## 5. 検証が未完了の項目

### P0-2. merge後`main`の再検証 — completed

Current main `2af1a5e`をGitHub Actions run `29582279740`で再検証した。

- targeted dialogue-stack tests: 48 files / 423 tests passed、1 file / 1 test skipped
- full tests: 109 files / 1118 tests passed、1 file / 13 tests skipped、5 todo
- TypeScript: passed
- production build: passed
- diff check: passed

静的確認ではsession、preview、storage、approvalはproduction接続済みである。request ownershipはpartialであり、conversation/turn identity、explicit cancel、clear-conversation UI、keyboard/IME/focusは未接続である。

### P0-3. browser interaction — not verified / P1へ引継ぎ

特に次が未完了である。

- IME composition中に送信しない
- Enterで改行する
- Ctrl/Meta+Enterで一回だけ送信する
- 完了・失敗後にfocusを復元する
- active request中の二重送信を拒否する
- selected week変更・session reset・explicit cancel後の旧resultを適用しない
- modal close中に完了したpreviewを再表示時に復元する
- reopen後にuser発話、assistant応答、preview内容、draft昇格操作を表示する
- retryで新しいrequest/turn identityを発行する

## 6. P1の残課題

### P1-1. request ownershipのproduction統一

moduleやReducer contractは存在するが、conversation、turn、request、revision、selected week、explicit cancel、reset、retryの所有者を一つのcontrollerへ統一し、production entrypointとbrowserで検証する必要がある。

modal closeまたはpresentation unmountだけではrequestをcancelしない。旧resultを破棄するのは、selected week変更、session reset、explicit cancellation、revision不一致等の意味的なinvalidating eventである。

### P1-2. approvalのserver-side idempotency

現行item ledgerはlocalStorage境界である。同一browserの通常retryには有効だが、次を完全には防げない。

- multi-tab同時approval
- 別端末からのapproval
- localStorage消去後の再approval
- crashとpartial successの跨端末retry

server-side transactionでoperationをclaimし、`userId + sourceDraftBlockId`を永続idempotency keyとして扱う必要がある。

### P1-3. trace privacyとlifecycle

conversation trace基盤はあるが、production運用に必要な次が未実装である。

- server-side rotating HMAC subject token
- 保存前redaction
- 本文・snapshot・metadataの180日TTL
- account deletion cascade
- admin read権限とaudit log
- export時の再redactionとunlink
- privacy notice、利用規約、初回acceptance gate
- privacy/legal review

### P1-4. longitudinal personalization profile

session再開は実装されたが、account-linkedな長期個別最適化は未実装である。

必要な対象:

- 週の始まり
- 学習速度と見積り誤差
- 継続しやすいsession長
- 固定生活制約
- 提案の採用・修正・拒否傾向
- 計画と実績の差
- profile factのorigin、confidence、scope、confirmedAt、expiresAt
- profile訂正、reset、account deletion
- 原履歴180日TTL

### P1-5. 週の始まりprofile

product decisionでは、初回に月曜始まりまたは日曜始まりを確認しaccount-linked profileへ保存する。現在は未実装であり、PR #5のpending range契約で動作している。

## 7. P2の構造・保守性課題

### P2-1. `App.tsx`のapplication service化

`App.tsx`がcomposition rootに加え、週間計画turn、request ID、approval ledger、preview承認、予定保存を担当している。`useWeeklyPlanningController`等へuse caseを抽出する必要がある。

### P2-2. `NaturalLanguageAssistant.tsx`の責務集中

単発AI予定入力と複数turn週間計画、AI呼出、preview、approval、表示が同居している。state ownerとuse case boundaryを先に分ける必要がある。

### P2-3. `QuickEntryModal.tsx`の複合form state

Todo、単発予定、繰り返し予定、実績、AI、週間計画等を独立`useState`の組合せで管理している。modal shellとformを分離し、form stateをdiscriminated union Reducerへ移す必要がある。

### P2-4. `usePlannerDataState.ts`のgod hook

予定、実績、Todo、教材、時間割、repository、migration、navigation、error diagnosticsが一つのhookへ集中している。use case単位のoperation hookへ段階的に分割する必要がある。

### P2-5. command contractの正本が複数ある

TypeScript型、runtime validator、AI schema、prompt、adapter、storage decoder、testsが別々に手書きされている。command catalogを正本にし、capability、version、AI可否、legacy可否、JSON Schemaを導出する必要がある。

### P2-6. `PlanningState`の導出可能な重複state

`mode`や`lastAssistantMessage`等を複数actionが同期更新するため、action追加時の更新漏れを起こし得る。selectorまたは単一finalizerへ寄せる必要がある。

### P2-7. pipeline stage contractが弱い

interpret、validate、reduce、assumption、request build、schedule、dialogue、traceの段階は存在するが、後段が前段の内部表現を参照できる。stage間の型契約を明示する必要がある。

### P2-8. storage moduleへのdecoder集中

厳格validationは維持すべきだが、intake、draft、preview、behavior metadataのdecoderを一つのstorage moduleが複製所有している。aggregate近傍へdecoderを移し、storageはversion・migration・save/loadを担当する形へ整理する。

### P2-9. CSSが子DOMからmodeを推測する

`quick-entry.css`が`:has(...)`等で子componentのclassから親layoutを切り替える。rootへ明示的な`data-layout`またはmodifier classを渡し、feature単位へ分割する必要がある。

### P2-10. dependency injectionとrepository portが弱い

AI factoryとrepository singleton importにより、controller・hookの独立testとbackend差替え境界が弱い。clock、ID factory、AI interpreter、renderer、ledger repository、planner repositoryを明示dependencyとして渡す必要がある。

### P2-11. error、diagnostics、user noticeの混在

provider固有error解釈、application failure、ユーザー向け文言を分離する必要がある。

### P2-12. props surfaceの過大化

rootからmodalへentity、navigation、CRUD、週間計画操作が大量に渡る。featureごとのview model/controller objectへまとめる。ただし万能Contextへ一括移行しない。

### P2-13. CI architecture guard不足

次が未導入である。

- lint
- format check
- feature import boundary
- cycle detection
- changed-file complexity report
- `src`外runtime codeのstatic check
- dependency upgrade時の`skipLibCheck: false`検証

### P2-14. bundle budget不足

500kB超chunk等の警告はあるが、PRごとの増加量を継続監視するbudgetがない。

### P2-15. test architectureの分類不足

回帰test、property test、component testが多いことは強みである。一方、catch-all testの重複はrefactorを困難にする。domain invariant、parser/validator、Reducer transition、application workflow、component interaction、storage migration、E2E critical pathへ分類する必要がある。

### P2-16. documentation lifecycleの自動検査不足

open、closed、reopened、supersededのMarkdownが手動同期であり、古いbranch・head・queueがcurrent instructionに見える危険がある。固定metadata、superseded link、target commit、status checkを導入する必要がある。

### P2-17. 一時automation Issueの整理

PR #5の一時workflow probe、migration、verification用Issueがopenのまま残ると、現在も失敗中または実行待ちに見える。product bugのIssue #21と区別し、完了またはnot plannedへ整理する必要がある。

## 8. deferred backlog

次はPR #5の直接回帰ではないが、週間計画の完成に向けて残る。

- generic progress unit（page、word、problem、report stage等）
- deterministic replanning trigger
- scheduler二系統の整理
- legacy fallback semanticsとretirement条件
- command schema / runtime validator / scheduler boundaryの網羅性
- scheduler capacity policyとatomic split permission dialogue
- 時刻不定の生活制約
- dead message state / unreachable branch / renderer不要callの整理
- opportunity annotationのplacement score高度化

## 9. 推奨実施順

1. Issue #21の漢数字絶対日付guardを修正する。
2. merge後`main`でfocused/full test、TypeScript、build、diff checkを再実行する。
3. browser roleplayでclose-resume、reset/stale、IME、keyboard、focus、approvalを確認する。
4. current contract、architecture、spec、roleplayのstatusをこのpost-merge stateへ同期し続ける。
5. request ownershipをcontrollerへ統一する。
6. `App.tsx`から週間計画controllerを抽出する。
7. 単発AIと週間計画UIを分離する。
8. QuickEntryModalをshellとformへ分離する。
9. server-side approval idempotencyを実装する。
10. trace privacy、TTL、account deletion、access controlを実装する。
11. longitudinal personalization profileと週始まり設定を実装する。
12. command catalog、storage decoder、repository port、CI guardを段階的に整理する。

## 10. 文書間の優先順位と競合解消

PR #5 merge後の実装事実については、次の順で読む。

```text
weekly-planning-current-contract-status.md
→ weekly-planning-pr5-post-merge-status.md
→ weekly-planning-roadmap.md
→ weekly-planning-roleplay-status.md
→ architecture / product spec / roleplay test planの非競合部分
→ active tasks
→ closed / historical / superseded records
```

2026-07-17時点で、次の旧記述はcurrent contractではない。

- PR #5がmerge前であるという記述
- provider通常経路はsingle AI interpreterのみでrules/AIをmergeしないという記述
- modal closeまたはpresentation unmountだけでactive requestをcancelするという記述
- AI/rules統合方式、週始まり、trace保存方針がdecision pendingであるという記述
- PR #5以前のqueue、branch名、head、test件数を現在statusとして扱うこと

長大なproduct spec、architecture、roleplay test planに残るhistorical status列や旧queueは、この文書とcurrent contract statusで上書きする。scenarioの厳格契約を修正する場合は、対応taskとroleplay statusも同じ変更で更新する。
