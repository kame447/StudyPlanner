# Stable V5 verification・migration・default cutover

Status: active / structural handoff repair in draft PR, adoption gates open
Priority: P1
Created: 2026-07-28
Updated: 2026-07-31

Audit:
- `../audits/20260731-weekly-planning-semantic-state-handoff-seven-audit.md`

## 現在地

実装・接続済み:

- AI-only semantic normalizer、strict schema、最大1回repair
- Fact Graph V5、lifecycle、generic scheduler、deterministic dialogue/preview
- staged Graph commit、local session persistence、approval bridge
- request ownership、stale discard、IME/focus guard
- rendererへの会話/Fact context、renderer trace persistence

PR #107で実装中:

- `明日`planningWindow omission repair
- machine pending question
- exact target short-answer binding
- typed renderer action contract
- semantic handoff七視点監査とtask inventory更新

## Open gates

- PR #107のfocused/full/typecheck/build
- Stable V5 actual AI real-eval
- browser roleplay
- generic semantic turn delta/coverageの後続設計
- current-time hard boundary
- external source production adapter
- old persisted state migration decoder/dry-run
- production read-only shadow
- rollback rehearsal
- default cutover decisionとobservation period
- legacy runtime deletion

## Required evaluation

- 一日、今週、来週、非連続日、曜日集合、exact除外日
- short answerと複数unresolved target
- task/component/workload/effort
- correction/remove/supersede
- availability、fixed commitment、existing plan、external source
- create authorization、insufficient capacity、generic non-study task
- renderer paraphraseがFact bindingを変えないこと
- same logical conversation trace continuity

## Default cutover禁止条件

- automated verificationがred
- actual AI/browser未実施
- unresolved BLOCKER/MAJOR audit finding
- current-time boundary未実装
- Graph/PlanningState commit非原子的
- parser fallback復活
- renderer textが状態遷移へ影響する
- trace split/loss再発
- migration/rollback未検証

## 完了条件

- [ ] PR #107 focused/full/typecheck/build/diff checkがgreen
- [ ] actual AI real-eval reportを保存
- [ ] browser roleplay証跡を保存
- [ ] multi-turn semantic equivalenceを評価
- [ ] migration decoder/dry-run/rollback fixtureを実装
- [ ] privacy gate付きproduction shadowを実行
- [ ] default cutover前七視点監査を完了
- [ ] rollback rehearsal成功
- [ ] observation periodで重大regressionなし
- [ ] default cutover後だけlegacy削除を開始