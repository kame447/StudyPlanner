# リロード後に復元した仮予定の承認lifecycleを定義する

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `20260718-weekly-planning-approval-validation-session-binding.md`

## 1. 背景

2026-07-18の全体監査で、リロード後に復元された仮予定が恒久的に承認不能であることを確認した。

観測事実:

- 仮予定と`previewMetadata`(conversationId含む)はlocalStorageへ永続化される(`src/features/weeklyPlanning/weeklyPlanningStorage.ts:631-639`)。
- 承認検証が参照するsession runtimeはmoduleレベルsingletonで揮発する(`src/features/weeklyPlanning/planning/weeklyPlanningSessionRuntime.ts:10`)。
- リロード後、`metadata.conversationId`が存在するのにruntimeがnullのため、`validateWeeklyPreviewApproval`は必ず`session-runtime-unavailable`のinvalid扱いになる(`src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts:139-141`)。表示メッセージは「この仮予定は保存できません。最新案を作り直してください。」。
- intakeStateの`assumptionProposalRecords`はsession-onlyとして保存時にstripされるため、リロード後にruntimeを正しく再構築する材料も現状はない(`weeklyPlanningStorage.ts:565-569`)。
- つまり、仮予定を復元して表示する一方で、承認だけは必ず失敗する。close-resume契約(modal閉→再表示で復元)と実質矛盾している。
- Issue #43(実ブラウザでの非同期操作確認)の「処理中に画面を閉じて再表示した場合の復元」はまさにこの領域で未検証。

## 2. 目的

リロード後の仮予定について「承認できる」か「再計算が必要と明示する」のどちらかへproduct decisionを確定し、実装と表示を一致させる。復元表示されるのに承認だけ黙って失敗する状態を解消する。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`(reviewable approval)
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(reload時のsanitize、preview authorization)
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001(reload系scenarioの追加が必要)

## 4. Entry conditions

- product decisionを先に確定する(下記10章の選択肢A/B)。決定はcurrent contract statusへ記録する。
- `20260718-weekly-planning-approval-validation-session-binding.md`の完了後に着手する(conversationIdが実値になってから復元仕様を決める)。
- 復元時に必要な検証材料(stateRevision、仮定の解決状態)の最小集合を確認する。

## 5. 対象ファイル

- 変更(選択肢により変動。実装を広げず、決定した側だけを変更する):
  - A案: `src/features/weeklyPlanning/weeklyPlanningStorage.ts`(runtime要点の永続化とload時再構築)、`weeklyPlanningSessionRuntime.ts`(再構築入口)
  - B案: `src/components/NaturalLanguageAssistant.tsx`(復元blockの「再計算が必要」表示と承認ボタン非表示)、`useWeeklyPlanningApplication.ts`(復元判定の公開)
- 新規: なし
- テスト: 保存→リロード(runtimeクリア)→承認の経路テスト。storage round-trip検証。

## 6. 現在の処理経路

```text
保存: saveWeeklyPlanningState(draftBlocks + previewMetadata永続化、proposalRecordsはstrip)
リロード: loadWeeklyPlanningState(pendingTurn/pendingApproval除去、blocks復元)
承認: validateWeeklyPreviewApproval → conversationIdあり && runtime null
→ session-runtime-unavailable → 常に拒否
```

## 7. 確認済みの事実

- リロード後に新しいturnを送信するとruntimeは再publishされるが、conversationId/stateRevisionは新会話のものであり、復元blockのmetadataとは一致しないため、いずれにせよ承認不能のまま。
- behaviorMetadataを持たないlegacy blockは`legacyPreviewId`経路で承認可能(こちらはruntime不要)。挙動が復元経路によって非対称。

## 8. 未確認事項

- 実ブラウザでの再現(Issue #43)。
- 復元後の仮定(assumption)の有効性をどこまで保証すべきかというproduct判断。

## 9. 問題点

- 「復元して見せるが承認は必ず失敗し、理由も再計算誘導も文脈なしに表示される」は、progressive disclosure・reviewable applyのUX原則に反する。
- fail-closed自体は安全側だが、失敗が恒久的であることをUIが伝えない。

## 10. 修正方針

いずれかをproduct decisionとして確定してから実装する。

- A案(承認可能にする): runtime snapshotの要点(conversationId、stateRevision、仮定提案の解決状態)を週間計画状態と同じ保存境界へ永続化し、load時にruntimeを再構築する。保存材料の改ざん・不整合はfail-closedを維持する。
- B案(再計算必須と明示する): 復元blockを「再計算が必要」stateとしてUIに明示し、承認ボタンを出さず、再計算導線を提示する。検証ロジックは変えない。

推奨はB案先行(小さく安全)+A案は`20260716-weekly-planning-approval-persistence-and-idempotency.md`のserver-side設計と合わせて再検討。

## 11. 触らない範囲

- 承認検証の判定規則(fail-closed方針を弱めない)
- server-side永続化
- preview生成、scheduler
- 決定しなかった側の案の実装

## 12. 受け入れ条件

- リロード後の仮予定に対し、UIの表示と承認可否が一致する(承認できないなら承認導線が出ない、または明示的な再計算誘導が出る)。
- 復元→再計算→新しい仮予定→承認のhappy pathが通る。
- legacy block(behaviorMetadataなし)の承認経路の挙動を変えない。
- fail-closed境界(改ざんデータ、他ユーザーmetadata)を弱めない。

## 13. テスト観点

- unit: load後のruntime有無と承認可否判定。
- integration: 保存→load(runtimeクリア)→承認試行→期待動作(A案: 承認成功 / B案: 導線非表示と誘導表示)。
- browser/manual: 仮予定作成→リロード→表示と操作の一致を確認(Issue #43と統合)。
- regression: storage round-trip、close-resume(リロードなし)の既存契約。
- property/fuzz: storage validationの既存propertyテストを維持。

## 14. リスク

- A案はlocalStorageへ仮定状態を置くため、改ざんによる承認バイパスを防ぐ検証が必要。
- B案は再計算頻度が上がり、AI呼び出しコストが増える。

## 15. Dependencies

- 先行: `20260718-weekly-planning-approval-validation-session-binding.md`。
- 関連: `20260716-weekly-planning-approval-persistence-and-idempotency.md`(A案の恒久解はserver-side設計に含める)。

## 16. Exit conditions

- product decisionをcurrent contract statusへ記録する。
- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- browser確認の残項目をIssue #43へ同期する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
