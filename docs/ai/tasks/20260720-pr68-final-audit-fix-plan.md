# PR #68 統括監査指摘の修正計画

## 対象

- ブランチ: `agent/fix-weekly-planning-trace-and-dialogue-final`
- 監査対象コードHEAD: `23d7676370b3efebc8d1465dfd01abc32c6462ca`
- M-8以外の実装完了コミット: `d9726b47340b2b3ef8907ea6f52b4ce37fd431eb`
- 詳細: `docs/ai/audits/20260720-pr68-final/final-audit.md`

## 実装原則

各項目を独立した修正単位として扱い、対象外の指摘を同時に変更しない。各単位では監査反例を回帰テストとして追加し、実装後にfocused testを成功させる。対象項目の完了後に全suite、production build、`git diff --check`を実行する。

## 修正単位

### T1 / M-1: life constraint時刻grounding — 完了

時刻の分精度、start/endの役割、kindと時刻の同一節対応を検証する。hour-only入力は`:00`だけを許可し、明示minuteの切捨て、endpoint swap、複数節cross-associationを拒否する。

### T2 / M-2: meal/bath短答の質問文脈 — 完了

曖昧な短答を黙って破棄せず、値を一意に確定できない場合は限定的なrepairへ回す。表示質問を一ターン一問へ統一し、保存contextとの不整合を解消した。

### T3 / M-3: unit-rateの単位grounding — 完了

単位なし数値を複数のcanonical値へgroundingできないようにし、単位を一意に確定できない短答は確認を継続する。

### T4 / M-4: priorityの完全性と順序grounding — 完了

既知fieldの完全被覆と、発話で明示された全相対順を検証し、partial orderとtail permutationをconfirmed priorityとして受理しない。

### T5 / M-5: 一般的な「科目」のexam誤分類 — 完了

`1科目`だけを院試scope signalとして扱わず、明示的なexam文脈または既存exam scopeがある場合に限定した。

### T6 / M-6: accepted-factのcanonical表示 — 完了

canonical値と矛盾する`rawText`をvalidation境界で表示根拠から除外し、受理表示と保存stateの不一致を防止した。

### T7 / M-7: trace retryのidempotency — 完了

immutable同値比較からserver生成の`expireAt`を除外し、同一payloadのretryがexpiry更新だけを理由にconflictしないようにした。その他の差分は従来どおり拒否する。

### T8 / M-8: structural IDのprivacy境界 — 保留・未着手

ユーザーとの議論対象として保留する。関連するvalidator、redaction、admin出力は変更していない。

### T9 / M-9: legacy trace handleの取得 — 完了

新形式validatorを緩めず、旧実装の限定的なlegacy handleだけを認識し、legacy読取分岐へ到達させた。

## 検証結果

M-8を除くT1〜T7とT9について、focused回帰、全テストsuite、TypeScriptおよびproduction build、`git diff --check`が成功した。一時適用script、診断ログ出力、追加CI jobは最終commitから除去し、通常CIへ戻した。

## 残件

M-8は方針未確定のため未修正である。統括監査のMINOR指摘はこの修正単位の対象外であり、別タスクとして扱う。
