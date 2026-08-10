# 週間計画 AI ロードマップ

Status: canonical / active
最終更新: 2026-08-11

- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)
- Current execution sequence: [../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md](../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)
- Human-reviewed real API loop: [../tasks/20260810-weekly-planning-human-reviewed-conversation-improvement-loop.md](../tasks/20260810-weekly-planning-human-reviewed-conversation-improvement-loop.md)

## 0. 最上位設計原則

週間計画では、ユーザーの自然言語、会話文脈、指示、訂正、承認、数量役割、日付・時間帯の意味理解をAIが担当する。

deterministic codeは、AIが出した意味表現に対するschema、reference、revision、owner、formal binding、Fact Graph lifecycle、readiness、scheduler、preview、approval、save、persistence、安全境界を担当する。raw user textを後段でregex、keyword、dictionary、parserにより再解釈してAI出力を上書きしない。

AI orchestrationを複数呼び出しへ分ける場合も、意味解釈はAIに残す。deterministic routerはmachine stateから「どのsemantic責務へ渡すか」を選ぶだけで、発話の意味を独自判定しない。

rendererはtyped application decisionを自然な日本語へ変換する。renderer文面から状態や意味を逆推定しない。

## 1. 現在の基準線

PR #109で、Stable V5の主要経路を実API会話と決定論的回帰から修正している。

確認済みの主要経路:

```text
自然発話
→ AI semantic interpretation
→ validator / 必要時のみAI repair最大1回
→ formal binding / Fact Graph
→ readiness / scheduler
→ AI renderer
→ preview
→ 自然発話による訂正
→ re-preview
→ preview保持
→ draft block昇格
→ approval / Plan save application境界
```

今回の改善ループで修正した主要クラス:

- 過去turnのplanning windowをdeltaへ再送する問題
- repairが正しい別Factまで消す問題
- 総量と完了量からremainingを扱う数量意味の不整合
- 複数taskの一部だけworkloadがある状態をreadyとする問題
- pending answerを既存workloadへ誤bindingする問題
- workload targetをvalidatorが拒否する契約ずれ
- current-turnに根拠のない既存Factコピーをvalidatorが通す問題
- no-op turnでrevisionが進む問題
- no-op turnでpreviewが消える問題
- scheduler既定時間帯が明示された曜日・時間帯を上書きする問題
- preview→draft→approval経路の結合テスト不足
- prompt policy overheadの肥大化

固定文言や固定scenarioの自動合否ではなく、AI会話は実APIで観測し、人間レビュー前に開発エージェントが明確な欠陥を修正する。

## 2. 現在の実行順序

以下の順番を変更しない。

```text
Phase 1: PR #109 を機能凍結してmerge-readiness確定
→ Phase 2: PR #109をmainへmerge
→ Phase 3: legacy / 過去経路削除
→ Phase 4: Stable V5挙動不変リファクタ
→ Phase 5: 整理後コードを7視点で再棚卸し
→ Phase 6: 新規会話改善・機能追加を再開
```

詳細は `20260811-weekly-planning-merge-cleanup-refactor-sequence.md` を正とする。

### Phase 1中の禁止事項

- #109へ新機能を追加する。
- partial semantic acceptanceなど後続機能を混入する。
- legacy削除を始める。
- 挙動改善目的の大規模リファクタを始める。
- 固定scenarioを通すためのsemantic patchを追加する。

Phase 1で許可するのは、merge blocker修正、テスト妥当性修正、依存安全性修正、文書同期だけである。

## 3. merge gate

PR #109をmergeしてよい条件:

- applicationから到達する週間計画runtimeがStable V5に固定されている。
- semantic architectureがAI ownership原則を満たす。
- 実API複数turnで主要経路を確認している。
- preview訂正後の曜日・時間帯がschedulerへ保持される。
- no-opでFact revisionを増やさず、idempotency履歴は維持される。
- previewがno-opで失われない。
- preview→draft→approval/save境界が決定論的に検証されている。
- stale preview、二重承認、二重保存、reload破損の回帰がgreen。
- typecheck、全Vitest、production build、diff checkがgreen。
- dependency auditに未判断のhigh/criticalがない。
- PR本文とcanonical docsが現在headと一致する。
- unresolved BLOCKER / MAJORがない。

merge直前に監査済みhead SHAが動いていないことを確認する。PR #109は履歴が大きいためsquash mergeを優先する。

## 4. merge後のlegacy削除

legacy削除は独立PRで行い、リファクタを混ぜない。

削除判定:

```text
productionから到達不能 + test-supportにも不要 → 削除
productionから到達不能 + Stable V5 test-supportに必要 → test-supportへ隔離
Stable V5が参照 → legacy扱いせず残す
```

対象候補にはold interpreter、old semantic experiment、parser fallback、legacy runtime switch、obsolete adapter、compatibility shim、旧real-api eval、obsolete workflow/script、固定prompt契約testを含む。

## 5. legacy削除後のリファクタ

挙動不変の独立PRとする。重点対象:

- focused / generic semantic orchestration
- validator chain / evidence validation
- existing entity binding / canonicalization / no-op detection
- Fact Graph mutation / revision / idempotency
- readiness / scheduler / preview lifecycle
- application executor / reducer / persistence
- dialogue decision / renderer contract
- test fixture builderと重複fixture

新しい仕様問題を見つけても、データ破壊・安全性BLOCKERでない限り同PRで仕様変更しない。Phase 5の棚卸しへ回す。

## 6. 7視点再棚卸し

整理後のmainをゼロベースで監査する。

1. AI意味理解責務とorchestration
2. state / Fact Graph / revision / idempotency
3. dialogue / pending question / renderer自然性
4. scheduler / preview / correction / approval / save
5. test妥当性・古い期待・過学習
6. trace / checkpoint / persistence / recovery
7. CI / dependency / deployment / operational safety

古いroadmapの残件を自動継承せず、この監査結果から新backlogを作る。

## 7. 後続候補

Phase 5後に優先度を再決定する候補:

- partial semantic acceptance / ambiguity lifecycle / clarification transaction
- current-time hard boundary
- cloud authoritative conversation / Graph repository
- cross-tab / cross-device conflict handling
- external source production adapter
- trace production operations
- approval operational rollout
- personalization
- migration / shadow / rollback / default cutover

これらは現在のPR #109へ追加しない。

## 8. テスト方針

自動テストは決定論的契約だけを保証する。AIの自然言語理解、自然さ、特定の言い回しを固定期待値にしない。

実API会話は一turnずつ観測し、semantic raw response、accepted document、validator/repair、binding、Graph、dialogue、renderer、previewを確認する。明確な問題があれば原因層を修正して同地点を再実行する。

過去の固定scenario oracle、model比較、旧semantic schema eval、固定renderer文面testをcanonical suiteへ戻さない。

## 9. 文書運用

canonicalな現在情報は次の4点へ集約する。

- 本roadmap
- `weekly-planning-semantic-v5-roadmap.md`
- `weekly-planning-current-contract-status.md`
- 現在のactive task MD

過去の監査はhistoryとして残してよいが、current queueの根拠として参照しない。supersededなtaskは`tasks/superseded/`へ、完了taskは`tasks/closed/`へ移す。root `tasks/`には現在実行する独立taskだけを置く。
