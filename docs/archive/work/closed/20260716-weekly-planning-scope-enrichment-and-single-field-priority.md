# exam scopeの部分補完と単一分野priorityを修正する

Status: closed
Closed: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening.md`

## 対象問題

traceではdeterministic parserが年度範囲を含む部分的なexam scopeを先に作成し、AIが同じ発話から抽出した`fields: ["OSnetwork"]`を返した。しかしvalidatorはexam scope全体をconfirmed扱いし、AI候補を`confirmed-slot-overwrite`で拒否した。

その結果、分野が空のままunit rateだけが入って`priority_policy`と`next_field_after_math`がmissingへ追加され、単一分野の入力に対して「優先したい分野」を尋ねた。

## 方針

confirmed判定をslot単位の有無だけでなく、既存scopeが部分的かどうかで扱う。`set_exam_scope`は既存値の破壊的上書きではなく、未確定属性の補完として受理できる場合に限り通す。

priority missingは、優先選択に意味がある複数分野の場合だけ追加する。単一分野では既定の順序が一意なので、`field_first`として自動確定するか、少なくともpriority質問を生成しない。

## 完了条件

- [x] 既存exam scopeのfieldsが空なら、AIの非空fields補完を拒否しない
- [x] 既存年度範囲をAI候補が欠落していても保持する
- [x] 既存の確定fieldsを異なるfieldsで置換する候補は拒否する
- [x] fieldsが1件ならpriority missingを追加しない
- [x] fieldsが2件以上なら現行のpriority確認を維持する
- [x] trace相当の回帰テストを追加する
