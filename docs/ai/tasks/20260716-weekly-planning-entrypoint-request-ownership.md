# 週間計画entrypointのrequest ownershipを統一する

Status: planned
Priority: P1
Requirement IDs: DA-TURN-001

## 1. 背景

request orchestratorとUI policyのmoduleは存在するが、実際の週間計画entrypointでconversation、turn、request、state revision、selected weekを一貫して所有しているかは未確認である。複数tab、reset、close、unmount、selected week変更時に旧resultを適用しない契約もbrowserで検証されていない。

## 2. 目的

週間計画の一requestに対する所有者をcontrollerへ一本化し、stale resultと二重送信をproduction entrypointで防止する。

## 3. Entry conditions

- AI/rules統合方式のdecision gateとは独立して実施できる。
- `20260714-weekly-planning-dialogue-stack-verification.md`のentrypoint調査結果を先に確認する。
- PR #5または後続変更がmainへ入った場合は、最新entrypointを再調査する。

## 4. 対象責務

- conversation IDとsession lifecycle
- turn ID、request ID、input state revision
- selected week変更
- active request中の二重送信
- reset、history clear、close、unmount
- retry時の新しいrequest identity
- stale resultのstate、history、status、previewへの適用禁止

## 5. 触らない範囲

- schedulerの配置判断
- AI promptの意味解釈規則
- approval persistence
- trace privacy方針
- UIデザイン全面変更

## 6. 受け入れ条件

- production entrypointが一つのcontrollerからrequest envelopeを生成する。
- active requestは一conversationにつき一件である。
- selected week、revision、reset、close、unmount後の旧resultを適用しない。
- stale resultはfallbackやerror messageへ変換しない。
- IME中の送信抑止、multiline、Ctrl/Meta+Enter、focus restoreが実UIへ接続される。
- unit、integration、browser scenarioで所有権を検証する。

## 7. Exit conditions

- module implemented、production connected、automated verified、browser verifiedを別々に記録する。
- 未接続箇所が残る場合はfully completeとしない。
