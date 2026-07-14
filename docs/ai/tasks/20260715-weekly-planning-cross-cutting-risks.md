# 週間計画の横断的リスクと後続改善

Status: planned
Priority: medium
Scope: 今回の会話trace実装中に確認できた構造的・security・scalability上の課題

本taskでは解決しない。会話ログ・時系列行動基盤の実装範囲を拡散させず、後続作業として管理する。

## 1. `NaturalLanguageAssistant`の責任集中

`NaturalLanguageAssistant.tsx`が次を同時に担当している。

```text
通常自然言語入力
週間計画会話state
pipeline orchestration
AI設定判定
preview state
preview表示
draft promotion
approval UI
error表示
```

ファイル規模が大きく、trace、retry、stale result、session lifecycleの接続位置が不明瞭になっている。

後続案:

```text
useWeeklyPlanningConversationController
useWeeklyPlanningPreviewController
WeeklyPlanningConversationPanel
WeeklyPlanningPreviewPanel
```

へ分離し、componentは表示とuser action委譲だけを持つ。

## 2. session identityが固定fallbackへ依存

週間計画behavior pipelineの既定conversation IDが`weekly-planning-session`である。複数tab、session reset、同一userの並行相談でidentity衝突が起こりうる。

後続案:

```text
UIでsession IDを生成
controllerがsession lifecycleを所有
pipelineへconversationIdとuserIdを必須入力
preview metadataとapproval operationへ同じsession IDを引き継ぐ
```

## 3. approval ledgerがlocalStorageのみ

approval operation ledgerはlocalStorageに保存される。別端末、storage消去、複数tab、同時approvalでidempotencyが保証されない。

後続案:

```text
approval operationをFirestoreへ移す
previewId + stateRevision + userIdをunique identityとして扱う
Cloud Firestore transactionでoperation claimを作る
plan保存とoperation item更新の整合性を設計する
```

## 4. client直書きtraceの改ざん耐性

今回のtraceは現行構成に合わせてWeb clientからFirestoreへbest-effortで保存する。security rulesでownershipとappend-onlyは制御できるが、clientがevent内容を任意に生成できる点は残る。

そのため、traceはdebug／evaluation候補であり、監査証跡、課金、security判定の根拠には使用しない。

後続案:

```text
重要eventだけCloud Functions／server proxyで再記録
client eventとserver observed eventを区別
App Check enforcement
server timestampとclient timestampを分離
```

## 5. retention設定がコードdeployと分離

Firestore TTLはrepository codeやsecurity rulesだけでは有効化されない。`expireAt`を保存してもpolicy未設定なら削除されない。

後続案:

```text
infra手順へTTL policy作成を追加
weekly_planning_trace_sessions.expireAt
weekly_planning_trace_entries.expireAt
single-field index exemptionも検討
```

## 6. user削除のcascade不在

現行rulesではprofileや各planner resourceのuser削除処理が明示されていない。traceを含め、Firebase Authentication user削除時の関連data削除が自動ではない。

後続案:

```text
account deletion use caseを定義
Cloud Functionsまたは管理者処理でuserId一致documentをbulk delete
削除対象collection catalogを一元管理
削除監査結果だけPIIを含めず保存
```

## 7. indexとquery cost

session一覧のfilterを増やすとFirestore composite indexが必要になる。全eventを無制限に取得するviewerはread costと描画負荷を増やす。

後続案:

```text
cursor pagination
session summary fieldsによるfilter
entry timelineのlimit + load more
event payloadを一覧queryに含めないprojection境界
長期集計を別collectionへmaterialize
```

## 8. trace schema migration

append-only dataは過去schemaが残る。TypeScript型を更新するだけでは既存entryを安全に読めない。

後続案:

```text
schemaVersionごとのdecoder
unknown event typeのsafe representation
export時のversion明示
破壊的変更ではmigrationではなく新decoder追加を優先
```

## 9. sensitive contentの分類

key-based redactionでは、通常keyの文字列値に含まれた個人情報や秘密情報を完全には除去できない。user発話自体も個人情報を含みうる。

後続案:

```text
本番traceの明示opt-in／opt-out
content保存とmetadata保存のfeature flag分離
メール、電話番号、URL query等の追加mask
export時の匿名化review step
roleplay fixtureへの自動投入禁止
```

## 10. 完了条件

各項目を独立taskへ分割し、優先度、依存関係、受入条件を付与する。今回のtrace基盤の完了条件には含めない。
