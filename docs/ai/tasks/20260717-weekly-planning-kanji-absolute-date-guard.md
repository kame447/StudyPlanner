# 週間計画で漢数字の絶対日付を曜日として誤解釈しない

Status: ready / implementation
Priority: P0
Created: 2026-07-17
Related Issue: #21
Related PR: #5
Parent status: `docs/ai/weekly-planning-pr5-post-merge-status.md`

## 1. 背景

PR #5の再レビューで、pending `来週`の状態において、漢数字を含む絶対日付の`日`を曜日の日曜日として扱う可能性が確認された。

例:

```text
八月一日から一週間
8月一日から
八月1日から
```

これらは絶対日付表現であり、曜日表現ではない。

## 2. 現在の問題

`parseExplicitDate`は主に算用数字の月日表現を認識する。一方、曜日抽出側の除外条件がASCII数字を前提としているため、`一日から`の`日`が日曜日候補として残る。

pending rangeが`来週`の場合、この誤認により、入力された絶対日付を範囲外として確認する代わりに、候補範囲内の日曜日へ誤確定する可能性がある。

これは次の二つを分けて修正する必要がある。

1. 自然言語上、どの文字列が絶対日付tokenかを認識する。
2. 認識した日付を現在のpending rangeへ採用してよいかを判定する。

単一の正規表現へ例外を追加して完了扱いにしない。

## 3. 対象責務

- 算用数字、漢数字、混在表記の月日tokenization
- 日付token内の`日`を曜日抽出から除外するguard
- 絶対日付解決失敗時に曜日へfallbackしない契約
- pending range内外の開始日判定
- deterministic parser経路とAI candidate adapter経路の共通range validation
- parser、adapter、pipelineの回帰test

## 4. 受け入れ条件

### 絶対日付として扱う

- `8月1日から一週間`
- `8月一日から一週間`
- `八月1日から一週間`
- `八月一日から一週間`
- `8月1日から`
- `8月一日から`

### 曜日として扱う

- `日曜日から`
- `日曜から`
- `来週の日曜日から`

### range guard

- pending `来週`の範囲内にある絶対日付だけを、現在contractに従って開始日候補へ反映する。
- pending `来週`の範囲外にある絶対日付は、範囲内の日曜日へ変換しない。
- 範囲外入力時はpending rangeを維持し、必要なclarificationを返す。
- selected dateを基準に解決し、実行時current dateで上書きしない。
- 通常のdeterministic経路とAI candidate経路で同じ結果になる。

### 回帰防止

- `8月1日`の既存算用数字処理を壊さない。
- 月日を含まない単独の`日`または`日曜`の曜日処理を壊さない。
- `一日だけ`等の日数表現を絶対日付として誤認しない。
- `一週間`の期間表現を月日として誤認しない。
- `夏休み`→`8月1日から一週間`の複数turn補完を壊さない。
- preview、storage、session persistenceへ無関係な変更を入れない。

## 5. 必須テスト

最低限、次のtable-driven testを追加する。

| input | expected classification | expected range result |
| --- | --- | --- |
| `8月1日から一週間` | absolute date | resolved or out-of-range clarification |
| `8月一日から一週間` | absolute date | same as Arabic form |
| `八月1日から一週間` | absolute date | same as Arabic form |
| `八月一日から一週間` | absolute date | same as Arabic form |
| `日曜日から一週間` | weekday | weekday resolution |
| `日曜から` | weekday | weekday resolution |
| `一日だけ勉強する` | duration/count | not absolute date, not Sunday |
| `一週間で進める` | duration | not absolute date, not Sunday |

さらに次をfocused integrationで確認する。

```text
selected date: 2026-06-26
pending 来週: 2026-06-29〜2026-07-05
input: 八月一日から一週間
expected: 8月1日または来週の日曜日へ確定しない。pending rangeを維持する
```

```text
selected date: 2026-07-26
pending 来週: 2026-07-27〜2026-08-02
input: 八月一日から一週間
expected: 2026-08-01を絶対日付として扱い、曜日の2026-08-02へ変換しない
```

## 6. 触らない範囲

- 週始まりprofileの実装
- schedulerの配置方針
- preview lifecycle
- approval persistence
- trace privacy
- UI全面変更
- genericな日本語数詞parserの全面実装

必要な漢数字範囲は月日解釈に限定し、別用途の数詞処理まで同じPRへ広げない。

## 7. 検証

```bash
git diff --check
npx vitest run <focused parser / adapter / pipeline tests>
npm run test:run
npm run build
```

実装後は、Issue #21、post-merge status、roadmap、roleplay statusを同期し、修正taskをclosedへ移す。
