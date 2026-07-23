# Weekly Planning Stable V5 Runtime Trial Contract

Status: canonical for current runtime connection and browser persistence
最終更新: 2026-07-24

この文書はStable V5の実環境接続、browser保存、conversation identity、rollback境界を定める。semantic model、availability、migrationの詳細はcurrent contractとarchitectureを継承する。runtime接続状態について競合する文書がある場合、この文書を優先する。

## 1. 現在の接続状態

Stable V5は既存週間計画UIへfeature flag付きで接続済みであり、PR #77とPR #79はmainへmerge済みである。

```text
NaturalLanguageAssistant
→ weeklyPlanningTurnExecutor
→ Stable V5 structured output
→ direct validation
→ Fact Graph V5 lifecycle
→ deterministic dialogue / scheduler
→ existing preview UI
→ existing approval / Plan save
```

default runtimeは`legacy`である。Stable V5は利用者または開発者が明示的に選択したsessionだけで使用する。

## 2. 有効化とrollback

```text
アプリ設定 → 週間計画AI → Stable V5
```

開発・preview用:

```text
?weeklyPlanningRuntime=stable-v5
VITE_WEEKLY_PLANNING_RUNTIME_MODE=stable_v5
```

「現行方式」へ戻すとruntime generationを切り替え、会話、preview、draft、Fact Graph、persisted Stable V5 sessionを同時に初期化する。同じconversationへlegacy stateとStable V5 graphを混在させない。

## 3. AIとdeterministic coreの責務

AIはraw user textをStable V5 semantic documentへ構造化する。

AIは次を決めない。

```text
target factの最終選択
formal fact ID / revision
missing優先順位
質問
readiness
placement
preview
approval
save
external event本文
```

provider failure、空応答、不正JSON、schema rejection、repair failureでparserへfallbackしない。repairはJSON/schema修復に限定し、一turn最大一回とする。

## 4. runtime safety

- existing planとtimetable本文はAIへ送らず、schedulerへ直接渡す。
- Graph revision不一致を拒否する。
- stale previewを承認できない。
- insufficient capacity時にpartial previewを返さない。
- non-study taskを`other`として保存する。
- Stable Graphをowner、week、conversationへ拘束する。
- staged GraphはPlanningStateのturn commit受理後だけfinalizeする。
- stale、cancel、commit rejection、failure時はstaged Graphを破棄する。

## 5. multi-turn identity

conversation IDは一つの対話系列を表す。turn ID、request ID、message IDはconversation内で再利用しない。

```text
<conversationId>:turn:<sequence>
<conversationId>:request:<sequence>
<conversationId>:turn:<sequence>:user
<conversationId>:turn:<sequence>:assistant
```

再マウントまたはページ再読込後は、復元済みmessage IDから最大turn sequenceを決定し、その次を発行する。memory上のcontroller counterだけを正本にしない。

短答結合はexpected revision、短答形、単一target、単一candidateを満たす場合だけ行う。「この条件で予定を作って」のようなauthorization turnでは、AIへ既存fact全文の再出力を要求しない。

## 6. browser persistence boundary

Stable V5はowner・week・conversationに拘束したlocalStorage envelopeへ次を一体保存する。

```text
conversation ID
PlanningStateの完了済みsnapshot
Fact Graph V5
preview candidates
draft blocks
savedAt
```

pending turnまたはpending approval中の半端なstateは保存しない。復元時にowner、week、conversation、Graph source、preview freshness、size、schemaを検証し、一部だけを復元しない。

これは同一browser内のruntime persistenceであり、server repositoryまたはcross-device persistenceではない。旧PlanningStateからStable V5 Graphへのmigration decoderも未実装である。

## 7. trace continuity boundary

Stable V5 traceは既存trace repositoryへuser/assistant turn、internal event、snapshotを保存する。同一owner・同一conversationのactive sessionは30分以内なら同じtrace sessionへ継続する。

ページ再読込でmodule memoryが失われても、内容を含まないcursorから次を復元する。

```text
local trace session ID
next entry sequence
next turn index
recent request IDs
last activity
```

cursorへraw user text、assistant本文、semantic document、Fact Graphを保存しない。repository append成功後だけcursorとcounterを更新し、失敗したwriteはsequenceを消費しない。

## 8. current verification state

mainではPR #77、#79、Pages build修正がmerge済みである。本branchではtrace continuityのfocused unit testとcontroller/reducer/trace integration testを追加した。

次の結果はbranch CIまたはlocal checkoutで実行して記録するまで未確認とする。

```text
focused trace tests
full Vitest
typecheck
Vite production build
branch preview browser roleplay
admin exportで同一session継続
```

GitHub上でstep/logが生成されないrunner failureと、test failureを区別する。

## 9. remaining gates

- cross-tab同時実行のbrowser-wide sequence reservation
- server/cross-device Graph persistence
- old state migration decoderとdry-run
- Stable V5実AI real-eval
- production shadow telemetry
- full browser roleplay
- default cutover判断
- legacy runtime削除

七視点監査は[20260724-stable-v5-trace-continuity](audits/20260724-stable-v5-trace-continuity/final-overseer.md)を参照する。
