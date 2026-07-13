# DA2: state-grounded dialogue orchestrator

Status: **queued — DA1/DA1b/approval after**
Priority: High
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-TURN-001, DA-ACTION-001, DA-FALLBACK-001

## 背景・目的

interpreter apply 後 snapshot を planner に渡す通常経路、active request、phase、turn envelope、cancel/stale、opening call budget が不足している。accepted state を保持したまま二段階 turn を接続する。

## 計画書との対応・対象

- spec: §12、§13
- 変更: dialogue orchestrator/request state/pipeline integration
- テスト: async contract、integration、P1/P2/P3/P6/P7

## 現在の処理経路・問題

interpreter/reducer/render の境界はあるが、old response の上書き、double submit、StrictMode duplicate opening、render-triggered provider call を防ぐ envelope がない。

## 修正方針・型契約

DialogueTurnEnvelope は conversationId、turnId、requestId、inputStateRevision、userText、createdAt。DialogueRequestState phase は idle/interpreting/applying/calculating/planning_response/validating_response/rendering/failed。opening は最大1 call、normal は interpreter+planner 最大2 call。interpreter success + planner failure は accepted state を保持して deterministic response。

## 失敗・concurrency・security・persistence

conversation 一 active request、duplicate text/turn/request、abort、mode reset、preview close、unmount、history clear は request token を無効化する。conversation/turn/request/input-output revision mismatch は state/history/status/preview に反映しない。timeout/error は input retention と retry indication、追加 AI call/merge なし。user text/history は untrusted JSON。request/phase は session-local、F5 で自動再実行/保存しない。UI/CSS、save/approval、scheduler全面改造、無関係 src は触らない。

## 受け入れ条件

1. state machine と envelope を strict に検証。2. stale/old response、abort/reset/close/unmount/history clear 後の commit なし。3. accepted state retention。4. opening/normal call budget。5. render で provider call なし。6. keyboard/focus/in-flight edit を壊さない。

## P1-P7・テスト・リスク

P1 novice/in-flight、P2 keyboard/IME/focus、P3 stale/duplicate/side effect、P4 stale preview/save boundary、P5 F5/schema、P6 fallback/mode/exam/non-exam、P7 DA-TURN-001/DA-ACTION-001/DA-FALLBACK-001 traceability。latency injection/property/roleplay、real model は DA3c。UI lifecycle race と既存 fallback 表示がリスク。

## Codexへの実装指示

対象限定、docs/ai/codex-task-guide.md 準拠。test/build/diff check/status を報告し、git add/commit/push/reset/restore/checkout/stash は行わない。

