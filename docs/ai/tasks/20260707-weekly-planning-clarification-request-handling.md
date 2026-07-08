# ユーザーの clarification request(質問語句への聞き返し)を扱う

ユーザーがアプリの質問語句の意味を聞き返す(「固定の予定って何ですか?」)と、interpreter がそれを学習量の不確実性 command 等に誤解釈し、適切な説明が返らない。clarification request を表す経路がないのが原因。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 背景(実例)

実例2 の続き:
```text
アプリ: 固定の予定があれば教えてください。
ユーザー: 固定の予定って何ですか？
（interpreter は学習量の不確実性に近い command として誤解釈し、適切な説明が返らない）
```

## 現行原因(コード確認済み)

- `ParsedWeeklyPlanningCommand` に **clarification request(ユーザーがアプリの用語/質問の意味を尋ねる)を表す command がない**(`add_fixed_event` / `set_*` / `note_uncertainty` / `mark_*` のみ)。
- AI interpreter は「固定の予定って何ですか?」を既存 command のどれか(uncertainty 等)に無理に写像し、state が誤って進む/進まない。
- clarification に対して「その用語の説明を返して同じ質問を維持する」経路(dialogue 側)もない。

## 対象範囲

- clarification request を表す command / intent(例: `ask_clarification`。責務分離文書の設計案 `ParsedWeeklyPlanningCommand.type = 'ask_clarification'` を最小実装)を interpreter schema と validator に追加する。どの slot/用語についての聞き返しかを持つ。
- clarification を受けたら、state を進めず(missing を消さず)、**その用語の deterministic な説明を返して直前の質問を維持する** dialogue 経路を足す。説明文は deterministic(用語辞書)で持ち、renderer が自然文に整える。
- 誤って uncertainty 等の command に写像されないよう、interpreter プロンプト/validator で clarification を分離する。

## 対象外

- 質問文そのものの言い換え(renderer context タスクが平易語彙を供給する。本タスクは「意味を聞かれたら説明する」経路)。
- fixed_events の状態モデル、completion target(別タスク)。
- 一般的な雑談・範囲外質問への応答(clarification=アプリの質問語句/用語に限定)。

## 完了条件

- 「固定の予定って何ですか?」で、state が誤進行せず、その用語の説明が返り、直前の質問が維持される。
- clarification が uncertainty 等の別 command に誤写像されない。
- weeklyPlanning テスト green / build 成功。

## 必要な regression test

- 「固定の予定って何ですか?」→ clarification として扱われ、missing 不変、用語説明が返る(fake interpreter で clarification command を注入して固定)。
- clarification が note_uncertainty / set_unit_rate 等に写像されないこと(validator/parse の分離)。
- 用語説明後、同じ質問(fixed_events)が維持されること。

## roadmap 対応

R2 interpreter 拡張(clarification)。責務分離文書の `ask_clarification` 設計案の実装。対話品質(spec §5 メンター対話)の一部。
