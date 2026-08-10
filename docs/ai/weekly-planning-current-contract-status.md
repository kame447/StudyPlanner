# weeklyPlanning current contract status

Status: canonical / active status overlay
Updated: 2026-08-11

- Main roadmap: [strategy/weekly-planning-roadmap.md](strategy/weekly-planning-roadmap.md)
- Semantic roadmap: [strategy/weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)
- Test philosophy: [testing/weekly-planning-test-philosophy.md](testing/weekly-planning-test-philosophy.md)
- Current execution sequence: [tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md](tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)

## 1. 現在のフェーズ

PR #109は新機能追加を凍結し、merge-readiness確認だけを行う。

次の順番を固定する。

```text
#109 merge-readiness確定
→ #109 merge
→ legacy / 過去経路削除
→ Stable V5挙動不変リファクタ
→ 7視点再棚卸し
→ 新規改善再開
```

legacy削除とリファクタを同一PRへ混ぜない。

## 2. AI意味理解とdeterministic core

現在の正本:

- 自然言語、会話文脈、訂正、承認、数量役割、日付・時間帯の意味理解はAIが担当する。
- provider failureやvalidation failureから自然言語parserへfallbackしない。
- deterministic codeはschema、reference、revision、formal binding、Fact Graph lifecycle、readiness、scheduler、preview、approval、save、persistenceを担当する。
- deterministic codeはraw user textを読み直してAIの意味を上書きしない。
- focused / generic semanticへorchestrateする場合も、routeはmachine stateで選び、意味解釈自体はAIに残す。
- renderer textからquestion/target/stateを逆推定しない。

## 3. Semantic / Fact Graph

実装・回帰確認済み:

- Stable V5 strict semantic document
- initial semantic + validator + AI repair最大1回
- Fact Graph V5 active/superseded/removed lifecycle
- staged apply / rollback
- machine-readable pending question
- existing entity formal binding
- effort estimate → workload target
- current-turn grounding / copied prior fact rejection
- planning window copied-state normalization
- duplicate/no-op normalization
- no-op時のrevision抑止
- no-op時もapplied turn / idempotency履歴保持
- quantity structural consistency validation
- reload可能なGraph/checkpoint validation

未着手または後続再評価:

- partial semantic acceptance
- ambiguity / unresolved fact lifecycle
- generic semantic turn delta / generic lifecycle applier
- cloud authoritative Graph repository

これらは#109へ追加しない。

## 4. Semantic orchestration / prompt

汎用semantic promptへ責務を無制限に積まない。

machine stateから責務を限定できるturnはfocused semanticへ分離してよい。ただし意味解釈はfocused AI自身が行う。

実測では、作成許可のfocused semantic化により、generic semantic約25KB級のrequestに対して約1.3KB級まで縮小できた。

prompt policy budgetは既存上限を維持し、上限緩和で肥大化を隠さない。

## 5. Dialogue / scheduler

確認済み:

- 複数taskの一部だけworkloadがある状態をreadyとしない。
- quantity role未確定をeffort estimateより先に解消する。
- explicit weekday / preferred time windowをschedulerへ保持する。
- scheduler既定時間帯はユーザーの明示preferred windowより弱い。
- preview後の修正をAIが`update_plan`として解釈しても、実変更があれば再previewへ進める。
- 実変更がないturnでは不要なscheduler再実行をしない。

実APIで確認した配置例:

- 数学: 2026-08-18 21:00–24:00
- 英語レポート: 2026-08-20 12:00–14:00

## 6. Preview / approval / save

確認済み:

- preview訂正後に修正版を再生成できる。
- no-op turnで既存previewを失わない。
- stale preview / stale revisionを承認させない既存契約がある。
- preview候補をUIからdraft blockへ昇格できる。
- draft状態の「一括承認して保存」がapplication approval callbackへ到達するコンポーネント回帰を追加済み。
- approval coreの二重処理抑止とsave application境界は決定論的テスト対象。

実ブラウザ上の最終クリック操作とproduction backend保存は、merge後の運用/ブラウザ検証とは区別する。

## 7. Persistence / recovery / trace

実装・回帰対象:

- conversation/turn/request/revision/week identity
- one active request / stale discard
- close/reopen continuity
- Graph/messages/preview/draft checkpoint復元
- owner/week/conversation-bound storage
- same logical conversation trace continuity
- renderer request/raw response/final decision trace
- request budget / bounded trace payload

production secret/TTL/Rules、cross-device authoritative store、offline conflict等は後続で再評価する。

## 8. テスト方針

自動テストは決定論的内部契約だけを保証する。

禁止:

- AIの特定日本語返答を正解として固定する。
- 固定scenarioのsemantic結果をquality PASSとして扱う。
- model比較実験を通常CIへ残す。
- prompt wordingそのものを回帰契約にする。

実API会話はhuman-reviewed observationとして一turnずつ確認する。

## 9. 2026-08-10〜11 改善ループで修正した主要問題

- copied planning windowがvalidator repairを誘発し、正しいtaskまで消える問題
- 総量と完了量の数量意味不整合
- 一部taskだけ完成していてもscheduler readyになる問題
- pending effort answerが元workloadへbindingされない問題
- Fact Graph validatorがworkload targetを拒否する問題
- current-turnに根拠のない過去Factコピーを許可する問題
- preview後曜日訂正がschedulerへ反映されない問題
- preferred night windowが既定09:00–22:00に切られる問題
- no-op turnでrevisionが増える問題
- no-op turnでpreviewが消える問題
- no-op revision抑止でidempotency履歴まで消える問題
- preview→draft→approvalのUI結合テスト不足
- semantic prompt policy overhead超過

## 10. Dependency / CI

2026-08-11の監査で、transitive dependencyの`nanoid` highと`postcss` moderateを検出した。

`npm audit fix`でpackage.jsonを変更せずlockfileのみ更新可能であり、更新後にtypecheck、全Vitest、production buildを通す手順を実施している。

GitHub Actionsの`actions/checkout@v4` / `actions/setup-node@v4`にはNode runtime deprecation警告がある。これは週間計画機能とは独立したCI保守として、#109へ追加の構造変更を混ぜず後続で扱う。

## 11. merge gate

#109をmergeしてよいのは次がすべて成立した場合だけ。

- unresolved BLOCKER / MAJORなし
- Stable V5 production path固定
- AI semantic ownership gate green
- 実API主要経路確認済み
- preview / correction / re-preview / approval境界green
- reload / stale / idempotency回帰green
- typecheck green
- full Vitest green
- production build green
- diff check green
- dependency auditに未判断high/criticalなし
- PR本文とcanonical docsが最新headと一致

merge後はlegacy削除へ進み、その後に挙動不変リファクタを行う。新機能を先に始めない。
