# Stable V5 trace continuity 七視点監査 総括

Status: implementation updated / branch consolidation archived / local verification pending
最終更新: 2026-07-24
Reviewed main baseline: `a669b166db30fa3f355371c089062eb5cf4e3987`
Draft PR: #83

## 判定

今回の実トレースで確認された「一つの会話がturnごとに別trace sessionへ分裂する」問題は、一覧UIのgrouping不足ではなく、conversation復元後にcontroller、local trace cursor、remote server handleのidentityが別々に初期化される実装不具合である。

修正後の不変条件は次とする。

```text
同一owner + 同一logical conversation
→ idle時間に関係なく同一local trace session ID
→ request/turn IDはcontroller memory、PlanningState.conversationRequestSequence、有効message IDの最大値より後
→ clear_conversation後もconversationRequestSequenceを保持
→ entry sequenceとturn indexは保存済みtrace列の続き
→ remote repository再生成後も同一server-issued handle
→ append失敗はcounterとrequest IDを消費しない
```

新しいconversation、明示的なsession reset、owner変更、week scope変更だけが新しいtrace identityを作る。30分idleをconversation終了条件として使用しない。保存cursor自体の保持上限は90日であり、過去に分割済みのhistorical logsは誤結合を避けるため自動mergeしない。

PlanningStateの一般的な`revision`をrequest sequenceとして推測しない。`conversationRequestSequence`がrequest identity専用の永続counterであり、`begin_turn`で単調増加を検証する。

## BLOCKER

コード上は対処済みである。

- 同じconversationでページ再読込またはruntime再生成後にtrace sessionが分裂する。
- 30分idle後に同じconversationを別physical sessionへ分割する。
- remote repository再生成または30日secret epoch境界でserver sessionを再発行し得る。
- 復元後に`request:1`、`turn:1`、message IDを再発行する。
- `clear_conversation`後の再読込でmessagesが空になり、過去のrequest IDを再利用する。
- append失敗時にsequenceだけ進み、retry後のentry列が欠損する。

ローカル検証が未完了のため、解消確認済みまたは採用可とはまだ判定しない。

## MAJOR

本修正の範囲でコードとtestを追加した。

- 既存testがconversation/Graphだけを確認し、controller、trace cursor、remote handleまで跨いでいない。
- Stable V5 persistenceを未実装とするcanonical MDがmainの実装と矛盾している。
- 一時的network failureでserver handleを捨てると、応答喪失時に別sessionへ移る可能性がある。
- Node Vitest環境でmemory Storageを明示しないremote repository testが、実際のhandle保存経路を通らない。
- 検証用Cloudflare scriptがproduction `build`を置換し、通常bundle buildとtest実行を混同していた。
- 同一作業の診断用PRとbranchが増え、固有差分の追跡と削除判定が困難になっていた。

別taskへ分離する。

- 同じconversationを複数tabで同時操作する場合のbrowser-wide sequence reservation。
- `responseSource`とsemantic interpretation sourceの概念分離。
- accepted factをassistant acknowledgementへ反映するdialogue grounding回帰。
- abrupt page close時の最終trace write durability。
- explicit reset、logout、consent撤回時のserver handle mapping cleanup。

## 七視点の結論

architectureではlogical conversationをlocal physical sessionとremote handleの継続scopeに統一した。schema/runtime contractではcursorとstored handleをclosed validationし、request identity専用counterをPlanningStateへ保存する。state atomicityではworking copyをappend成功後だけcommitする。dialogue/UXでは`clear_conversation`後も`conversationRequestSequence`を保持してID再利用を防ぐ。securityではowner-scoped local metadataだけを保持し、server認証を正本とする。observabilityでは一つのconversationを一つのentry列として追跡可能にした。test/merge hygieneではreload、idle、clear、repository recreation、stale handle、transient failureを回帰testへ追加し、同一作業をPR #83へ集約した。

## 変更範囲

```text
controller request sequence recovery
PlanningState.conversationRequestSequenceの永続化
clear_conversation時のsequence保持
metadata-only trace cursor
transactional trace sequence allocation
idle timeout split廃止
server-issued handle persistence
structural rejection時だけhandle再発行
transient append failureのsame-payload retry
runtime-memory-loss / idle / clear / remote reload regression tests
controller / reducer / trace integration test
Node Vitest用memory Storage導入
current contract、runtime contract、status、roadmap、docs index更新
PR #82 / #84 / #85固有資産のarchive
package.jsonの通常Vite build復元
一時Cloudflare検証scriptのrootからの除去
```

## branch consolidation

PR #84とPR #85はduplicateとしてclosedであり、mainへmergeしない。PR #82、#84、#85の固有資産と、PR #83に残っていた一時検証scriptは次へ保存した。

```text
docs/ai/audits/20260724-pr83-branch-consolidation/archive-manifest.md
docs/ai/audits/20260724-pr83-branch-consolidation/archive/
```

archive scriptは`.txt`として保存し、自動実行されない。archive元head、blob SHA、移植状況、branch削除gateはmanifestを正とする。ローカル検証と最終SHA比較が完了するまで旧branchを削除しない。

## 検証状態

commit `3ae9e1f`のCloudflare Pages branch previewが成功した記録はhistoricalである。その後にcontroller sequence、PlanningState、reducer、session storage、test、package設定が変更されているため、当時のbuild成功を現在headへ継承しない。

GitHub Actionsは現在利用できないため、本PRの検証証跡として使用しない。過去のstep 0件、logsなしのfailureもコード合否には使用しない。

`package.json`の`build`は通常の`vite build --config vite.config.mjs`へ戻し、rootの一時Cloudflare検証scriptを削除した。現在headに対するfocused tests、full Vitest、typecheck、Vite build、`git diff --check`はローカル実行待ちである。

## 最終gate

```text
PR #83のheadを固定
focused tests
→ full Vitest
→ typecheck
→ Vite production build
→ git diff --check
→ branch previewでreload・1時間idle・clear後再送を実操作
→ admin exportが一つのsessionになることを確認
→旧branch headとの最終差分・archive照合
→ unresolved review thread 0
→ review
```

上記の実行結果を取得するまでは、PR #83をDraft・merge不可とし、PR #82、#84、#85のbranchも削除しない。
