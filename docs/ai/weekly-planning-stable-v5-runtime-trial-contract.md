# Weekly Planning Stable V5 Runtime Trial Contract

Status: canonical for current runtime connection and browser persistence
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`

この文書はStable V5の実環境接続、browser保存、conversation identity、trace continuity、rollback境界を定める。semantic model、availability、migrationの詳細はcurrent contractとarchitectureを継承する。runtime接続状態または保存状態について競合する文書がある場合、この文書を優先する。

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

AIはraw user textをStable V5 semantic documentへ構造化する。target fact、formal ID、revision、missing優先順位、質問、readiness、placement、preview、approval、save、external event本文を決めない。

provider failure、空応答、不正JSON、schema rejection、repair failureでparserへfallbackしない。repairはJSON/schema修復に限定し、一turn最大一回とする。

## 4. runtime safety

existing planとtimetable本文はAIへ送らずschedulerへ直接渡す。Graph revision不一致、stale preview、partial placement、owner・week・conversation mismatchを拒否する。staged GraphはPlanningStateのturn commit受理後だけfinalizeし、stale、cancel、commit rejection、failure時は破棄する。

## 5. multi-turn identity

conversation IDは一つの対話系列を表す。turn ID、request ID、message IDはconversation内で再利用しない。

```text
<conversationId>:turn:<sequence>
<conversationId>:request:<sequence>
<conversationId>:turn:<sequence>:user
<conversationId>:turn:<sequence>:assistant
```

再マウントまたはページ再読込後は、復元済みmessage IDとPlanningState revisionからsequenceの単調下限を決め、その次を発行する。`clear_conversation`でmessagesが空になっても、同じconversation内の過去request IDへ戻らない。

短答結合はexpected revision、短答形、単一target、単一candidateを満たす場合だけ行う。authorization turnではAIへ既存fact全文の再出力を要求しない。

## 6. browser persistence boundary

Stable V5はowner・week・conversationに拘束したlocalStorage envelopeへconversation ID、完了済みPlanningState、Fact Graph V5、preview candidates、draft blocks、savedAtを一体保存する。

pending turnまたはpending approval中の半端なstateは保存しない。復元時にowner、week、conversation、Graph source、preview freshness、size、schemaを検証し、一部だけを復元しない。

これは同一browser内のruntime persistenceであり、server repositoryまたはcross-device Graph persistenceではない。旧PlanningStateからStable V5 Graphへのmigration decoderも未実装である。

## 7. trace continuity boundary

Stable V5 traceは既存trace repositoryへuser/assistant turn、internal event、snapshotを保存する。physical trace identityのscopeは次とする。

```text
trace scope = owner ID + logical conversation ID
```

同じscopeでは、ページ再読込、module memory消失、remote repository再生成、30分を超えるidleがあっても、同じlocal trace session ID、entry sequence、turn index、server-issued handleへ継続する。idle時間をconversation終了条件にしない。新conversation、明示reset、owner変更、week scope変更だけが新しいidentityを作る。

metadata-only cursorへ次を保存する。

```text
local trace session ID
next entry sequence
next turn index
recent request IDs
last activity
```

cursorへraw user text、assistant本文、semantic document、Fact Graphを保存しない。repository append成功後だけcursorとcounterを更新し、失敗したwriteはsequenceまたはrequest IDを消費しない。cursorは最大24件、各64 KiB、保持90日とする。

remote repositoryはserver-issued handleをowner・local sessionに拘束して保存する。repository再生成後は`startSession`を再実行せず同じhandleを使用する。serverがsession不存在、ownership conflict、legacy read-only、conversation conflictを明示した場合だけ再発行する。一時的network failureでは同じcanonical payloadを一度再送する。

過去に分割済みのtrace documentは誤結合を避けるため自動mergeしない。

## 8. current verification state

本branchでは次のtestを追加した。

```text
controller / reducer / traceを跨ぐ二turn結合
runtime memory loss後のsession・sequence継続
1時間idle後の同一session継続
clear conversation + reload後のrequest ID非再利用
repository再生成後のserver handle継続
stale handle recovery
transient append failureのsame-payload retry
write failure retryのcounter atomicity
cursorのcontent非保存、owner・schema・counter・unknown field拒否
storage key境界の衝突回帰
```

GitHub Actionsは`verify` jobを生成したが、step 0件・logsなしでrunner起動前に失敗している。code test failureとは判定しない一方、focused test、full Vitest、typecheck、Vite production buildの成功証跡もまだない。

## 9. remaining gates

```text
focused trace tests
full Vitest
typecheck
Vite production build
branch previewでreload・idle・clear後再送を実操作
admin exportで同一session継続
cross-tab sequence reservation
server / cross-device Graph persistence
old state migration decoderとdry-run
Stable V5実AI real-eval
production shadow telemetry
full browser roleplay
default cutover判断
legacy runtime削除
```

## 10. merge gate

PR #83はDraftのまま維持する。automated verification、browser roleplay、七視点監査、canonical MD同期、unresolved review thread 0を確認するまでmergeしない。

七視点監査は[20260724-stable-v5-trace-continuity](audits/20260724-stable-v5-trace-continuity/final-overseer.md)を参照する。
