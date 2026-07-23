# Weekly Planning Stable V5 Runtime Trial Contract

Status: canonical for runtime connection and local session continuity
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

この文書はStable V5の実環境接続、local persistence、trace continuity、rollback状態を定める。semantic model、availability、migrationの詳細契約はcurrent contract V5とarchitectureを継承する。接続状態または保存状態に関して他文書と競合する場合、この文書を優先する。

## 1. 現在の接続状態

Stable V5は既存週間計画UIへfeature flag付きで接続され、PR #77とPR #78を経て`main`へ統合済みである。

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ Stable V5 structured output
→ direct validation / Fact Graph V5
→ deterministic dialogue / scheduler
→ existing preview UI
→ existing approval / Plan save
```

defaultは環境変数で上書きされない限りlegacyである。Stable V5へ明示的に切り替えた利用者または開発環境だけがStable V5経路を使用する。

## 2. 有効化とrollback

```text
アプリ設定 → 週間計画AI → Stable V5
```

開発・preview用:

```text
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

「現行方式」へ戻すと即時rollbackする。runtime generationを同一conversationで混在させないため、mode切替時は現在の会話、preview、Fact Graph、Stable V5 local sessionを明示的に初期化する。

## 3. AI責務

AIは自然言語をStable V5 semantic documentへ構造化する。

AIはtarget factの最終選択、missing優先順位、質問、readiness、placement、preview、approval、save、external event取得を決めない。provider failure、schema failure、空応答、repair failureでparserへfallbackしない。

## 4. runtime safety

```text
existing plan / timetable
→ AIへ送らない
→ deterministic schedulerへ直接渡す
```

Graph revision不一致、owner不一致、conversation不一致、古いpreview、partial placement、承認時のsource fact不一致をfail closedで拒否する。non-study taskは`other`として保存する。

## 5. multi-turn

直前の決定論質問に対する短答を、単一の未解決factへ結合する。

```text
3時間です
今回進めたい量です
```

expected revision、短答形、単一target、単一candidateを満たす場合だけ適用する。「この条件で予定を作って」のような許可turnでは、AIは既存factを再出力しない。

## 6. Stable V5 local persistence

2026-07-23の実装以後、Fact Graph V5はsession-memory onlyではない。次をowner IDとweek startへ拘束した同一versioned envelopeとしてlocalStorageへ保存する。

```text
conversation ID
messages
compatibility intake state
Fact Graph V5
preview candidates
draft blocks
saved timestamp
```

保存前とload時にclosed validationを行う。owner mismatch、week mismatch、conversation mismatch、Graph source mismatch、破損JSON、未知version、過大payloadを破棄する。`pendingTurn`、`pendingApproval`、session-local proposal recordは保存しない。

ページ再読込後は、conversation、Fact Graph、preview、draftを同じrevision境界で復元する。未完了network request自体は再開しない。

## 7. trace continuity

quality traceのphysical sessionは、applicationのlogical conversationへ一対一で拘束する。

```text
trace scope = user ID + conversation ID
```

同じconversationでは、ページ再読込、runtime module再初期化、remote repository再生成、30分を超える無操作があっても、同じphysical trace session、連続sequence、連続turn indexへ追記する。新しいconversationまたは明示resetだけが新しいtrace sessionを生成する。

trace continuityはPlanningStateとは別のclosed local envelopeへ保存する。server-issued handleもclient repository instanceを越えて再利用し、secret epoch境界で不要なsession再発行を行わない。serverがhandleを明示的に拒否した場合だけ再発行する。

既に過去に分割されたtrace documentを自動mergeしない。誤った会話結合を避けるため、historical logsはそのまま保持する。

## 8. cloud syncとの区別

今回のpersistenceは同一browser profile内のlocal復元である。次は未実装であり、`20260716-weekly-planning-synced-conversation-session-store.md`を正とする。

```text
別端末復元
cloud authoritative revision
multi-client conflict resolution
offline cache同期
localStorage migration
account deletion cascade
```

local persistence完了を、cloud session store完了またはoperational deploymentと扱わない。

## 9. verification status

PR #82で次を検証する。

```text
runtime memory loss後のtrace continuity
1時間無操作後のtrace continuity
別conversationの分離
remote repository再生成後のserver handle continuity
stale handle recovery
transient append retry without handle rotation
focused tests
full test suite
TypeScript
Vite production build
git diff --check
```

実browser roleplay、複数tab、別端末、本番TTL、account deletion、privacy/legal reviewは自動検証と区別する。

## 10. merge gate

PR #82はDraftのまま維持する。七視点監査、automated verification、canonical MD同期、一時verification workflow削除、unresolved review thread 0を確認するまでmergeしない。
