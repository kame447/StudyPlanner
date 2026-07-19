# 週間計画におけるAI意味解釈と決定論境界

週間計画の自然言語入力では、AI interpreterを主たる意味解釈器とする。

AI interpreterは、発話の意図、訂正、省略、指示対象、分野間の関係、優先方針、生活制約の意味を解釈し、command候補へ構造化する。deterministic parserはAIの代わりに自然言語全体を再解釈する高性能な値入力口として扱わない。

deterministic側の責務は、既知の短答・明示形式に対する補助、canonicalization、runtime shape validation、時刻や数値の範囲検証、既知stateに存在しないID・分野の拒否、重複・競合・readiness invariantの維持、AI障害時の限定fallbackである。

validatorはAIの意味判断を正規表現で再現しない。AIが出したcommandの意味を別のルールparserで再判定するのではなく、commandが入力・既知stateから明白に逸脱していないことと、構造的不変条件を満たすことだけを確認する。

rendererも同様に、AIが質問文を自然化する責務を持つ。deterministic側はslot契約、禁止内容、質問数、順序、重複、明白な意味逸脱だけを検証し、失敗時に登録済み質問へfallbackする。

## 最終7監査の検証記録

PR #68の最終7監査では、AI意味解釈責務、grounding、構造的不変条件、readiness、質問文fallback、受理内容表示、trace保存、承認保存、入力境界、全体回帰を再検証した。

追加監査で、明示された目安時間とcommand値の不一致、明示された分野優先順の逆転、生活制約種別の取り違えを拒否する境界を復元した。曖昧な時間表現はAI意味解釈へ残し、明示数値がある場合だけ値の一致を検証する。分野順は既知分野だけでなく、発話で先頭として指定された分野との整合も検証する。生活制約は時刻だけでなく、睡眠・食事・入浴などの種別も入力または直前質問へgroundingする。

focused tests、全体テスト、TypeScriptおよびproduction build、`git diff --check`はすべて通過した。監査専用workflow、一時script、診断ログは最終コミットで除去した。
