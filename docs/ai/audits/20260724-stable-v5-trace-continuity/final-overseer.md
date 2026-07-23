# Stable V5 trace continuity 七視点監査 総括

Status: implementation complete / automated verification pending
最終更新: 2026-07-24

## 判定

今回の実トレースで確認された「一つの会話がturnごとに別trace sessionへ分裂する」問題は、一覧UIのgrouping不足ではなく、conversation復元後にcontrollerとtrace runtimeのidentity cursorが初期化される実装不具合である。

修正後の不変条件は次とする。

```text
同一owner + 同一conversation + 30分以内
→ 同一trace session ID
→ request/turn IDは既存message列の続き
→ entry sequenceとturn indexは既存trace列の続き
→ append失敗はcounterを消費しない
```

## BLOCKER

解消済み。

- 同じconversationでtrace sessionが分裂する。
- 復元後に`request:1`、`turn:1`、message IDを再発行する。
- append失敗時にsequenceだけ進み、retry後のentry列が欠損する。

## MAJOR

本修正の範囲で解消済み。

- 既存testがconversation/Graphだけを確認し、trace identityまで跨いでいない。
- Stable V5 persistenceを未実装とするcanonical MDがmainの実装と矛盾している。

別taskへ分離。

- 同じconversationを複数tabで同時操作する場合のbrowser-wide sequence reservation。
- `responseSource`とsemantic interpretation sourceの概念分離。
- accepted factをassistant acknowledgementへ反映するdialogue grounding回帰。

## 変更範囲

- controller request sequence recovery
- metadata-only trace cursor
- transactional trace sequence allocation
- runtime-memory-loss regression test
- controller/reducer/trace integration test
- current contract、runtime contract、status、roadmap、docs index更新
- 七視点監査記録

## 最終gate

```text
focused tests
→ full test
→ typecheck
→ production build
→ branch previewで二turn実操作
→ exportが一つのsessionになることを確認
→ review
```

このgateの実行結果を取得するまでは、merge可とは判定しない。
