# PR #68 統括監査指摘の修正計画

## 対象

- ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- 監査対象コードHEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- 詳細: `docs/ai/audits/20260720-pr68-final/final-audit.md`

## 実装原則

各項目を独立した修正単位として扱い、対象外の指摘を同時に変更しない。各単位では、監査反例を失敗テストとして追加し、実装後にfocused testを成功させる。全項目完了後に全suite、production build、`git diff --check origin/main...HEAD`を実行する。

## 修正単位

### T1 / M-1: life constraint時刻grounding

時刻の分精度、start/endの役割、kindと時刻の同一節対応を検証する。hour-only入力は`:00`だけを許可し、明示minuteの切捨て、endpoint swap、複数節cross-associationを拒否する。

### T2 / M-2: meal/bath短答の質問文脈

`meal_bath_constraints`直後の短答を黙って破棄しない。質問文脈だけでmeal/bathを一意に決められない場合は、値を確定せず限定的なrepairへ回す。表示した複数質問と保存contextの不整合も解消する。

### T3 / M-3: unit-rateの単位grounding

単位なし数値を複数のcanonical値へgroundingできないようにする。質問契約から単位が一意ならその単位へ変換し、一意でなければ確認を継続する。

### T4 / M-4: priorityの完全性と順序grounding

既知fieldの被覆と、発話で明示された全相対順を検証する。partial orderまたはtail permutationをconfirmed priorityとして受理しない。

### T5 / M-5: 一般的な「科目」のexam誤分類

`1科目`だけを院試scope signalとして扱わない。院試・過去問などの明示文脈、既存exam scope、または対応slotへの短答がある場合に限定する。

### T6 / M-6: accepted-factのcanonical表示

`rawText`を表示上の正本にしない。受理表示は確定したcanonical値から生成するか、validation境界でraw/canonicalの一致を保証する。

### T7 / M-7: trace retryのidempotency

retryごとに変化する`expireAt`がimmutable同値比較を壊さないようにする。同一payload再送が既存entryを成功扱いし、部分保存から収束できることを検証する。

### T8 / M-8: fallback structural IDと電話番号

要議論のため未着手とする。方針確定前にvalidator、redaction、admin出力を変更しない。

### T9 / M-9: legacy trace handleの取得

旧実装が保存した`weekly-trace-[UUID]`形式を、legacy読取分岐へ安全に到達させる。新形式validatorを緩めるのではなく、legacy handle用の限定的な検証経路を追加する。

## 実装順

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T9。T8はユーザーとの議論後に別途着手する。
