# 週間計画 人間レビュー付き実API会話改善ループ

Status: completed baseline / feature work frozen for PR #109 merge-readiness
Date: 2026-08-10–2026-08-11
Issue: #108
PR: #109
Branch: `agent/weekly-ai-conversation-eval`

後続の実行順は [20260811-weekly-planning-merge-cleanup-refactor-sequence.md](20260811-weekly-planning-merge-cleanup-refactor-sequence.md) を正とする。

## 目的

Stable V5を実OpenAI APIで複数turn動かし、各turnでtranscriptだけでなくsemantic raw response、accepted document、validator/repair、formal binding、Fact Graph、dialogue、renderer、previewを確認する。

明確な問題があれば次turnへ進めず、原因層を直して同じ地点から再実行する。会話品質の最終意思決定は人間が行うが、その前に開発エージェントが明確な欠陥を除去する。

## 固定原則

- 自然言語、会話文脈、訂正、承認、数量役割、日付・時間帯の意味理解はAIが担当する。
- deterministic codeはschema、reference、revision、formal binding、Fact Graph、readiness、scheduler、preview、approval、saveを担当する。
- raw user textを後段のregex、keyword、dictionary、parserで再解釈してAI出力を上書きしない。
- renderer textからmachine stateを逆推定しない。
- AIの返答文面や固定semantic結果を自動テストの正解にしない。
- structural/reference violationのAI repairは最大1回。
- promptへ規則を足し続けず、責務を限定できる場合はfocused semanticへ分離する。ただし意味解釈自体はAIに残す。

## 実APIで通した主要会話

代表経路:

```text
来週の勉強予定を立てたい
→ 数学のワークと英語のレポート
→ 数学80ページ中30ページ完了
→ 残り50ページを約3時間
→ 英語3000字中1000字完了
→ 残り2000字を約2時間
→ preview作成
→ 数学を火曜夜、英語を木曜午後へ訂正
→ re-preview
→ no-op/承認相当turnでもpreview保持
→ UIの「この内容で仮予定にする」へ接続
```

実測配置:

- 数学: 2026-08-18 21:00–24:00
- 英語レポート: 2026-08-20 12:00–14:00

preview候補→draft block昇格→「一括承認して保存」callback到達は決定論的コンポーネント回帰を追加した。

## 改善ループで修正した原因クラス

- 過去turnのplanning window再送がrepairを誘発し、正しいtaskまで失う。
- 総量と完了量をremainingとして誤表現する。
- 複数taskの一部だけworkloadがあってもreadyになる。
- pending effort answerを既存workloadへbindingできない。
- effort targetとしてworkloadをvalidatorが拒否する。
- current-turnに根拠のない過去Factコピーがacceptedになる。
- 標準曜日のstructured contractが曖昧でschedulerへ落ちる。
- explicit preferred timeをscheduler既定09:00–22:00が上書きする。
- preview後`update_plan`で再preview authorizationが適切に働かない。
- no-opでもFact revisionが増える。
- no-op turnでpreviewが消える。
- no-op revision抑止時にidempotency履歴まで戻してしまう。
- prompt policy overheadがbudgetを超える。
- preview→draft→approvalのUI境界に直接テストがない。

## orchestrationの判断

一つのgeneric semantic promptへ責務を積み続けると、単純な短答でも約25KB級のrequestになり、既存規則を落とす挙動が観測された。

そのためmachine stateだけで責務を限定できる処理はfocused semanticへ分離可能とした。deterministic routerは意味を判断せず、意味解釈はfocused AIが行う。

作成許可のfocused semanticでは約1.3KB級までrequestを縮小できた。今後の分割拡大はlegacy削除・リファクタ後の7視点再棚卸しで判断する。

## テスト境界

自動テストで保証する:

- schema / reference / current-turn grounding
- Fact Graph lifecycle / revision / idempotency
- pending question / formal target
- readiness / scheduler
- preview / stale / re-preview
- draft promotion / approval callback / save boundary
- persistence / reload / trace / request budget

自動テストで保証しない:

- AIの特定日本語返答
- 特定の言い換えに対する唯一のsemantic document
- 固定scenario transcriptの自然さ
- model比較の勝敗

詳細は `docs/ai/testing/weekly-planning-test-philosophy.md` を正とする。

## 完了判定

この改善ループの役割は「主要経路を動かし、そこで露出する明確な設計欠陥を一定水準まで除去する」ことだった。この基準線には到達したため、#109への新しい会話改善は凍結する。

残作業は会話改善の継続ではなく、次のmerge gateである。

```text
#109最終7視点監査
→ full CI / build / dependency / docs / PR同期
→ merge可否確定
```

merge後は必ずlegacy削除→挙動不変リファクタ→7視点再棚卸しの順に進む。
