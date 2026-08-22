# 【最優先】AI 抽出後の yearRange 喪失と対象年度の再質問を修正する(調査+修正)

> **完了記録(2026-07-07・コミット `97742b0`)**: reducer の `set_exam_scope` apply を scope 丸ごと置換から **merge**(既存 yearRange/fields/totalYears を新 command が明示した値でのみ上書き、未指定は保持)へ変更(仮説3を確定原因として修正)。foundation テストで「AI 由来 yearRange が後続ターンで保持され対象年度が再質問されない」ことを固定。weeklyPlanning 344 passed / build 成功。

実ブラウザの継続対話スモークで、AI が最初の入力から fields 5件・yearRange 2025〜2019・field_first priority を正しく返しているにもかかわらず、後続で対象年度が再質問され、ユーザーの再回答(2019〜2026)により当初 35件(7年×5)ではなく **40件・120時間**(8年×5×3h)で計画された。データ整合の実害であり最優先。

本mdの範囲外へ進まない。git add / commit / push はしない。production code は Phase 2 まで触らない。

## 確定している事実 / 調査前提

コード確認済みの事実:

- `set_exam_scope` apply(reducer)は「`totalYears && !yearRange` なら `year_range` を missing に追加、`yearRange` があれば除去」。よって **yearRange が state に入っていれば対象年度は聞かれない**。再質問された = yearRange が state に入っていない、または後で失われた。
- validator の `commandSlotKeys` は `set_exam_scope`(yearRange 付き)を `['exam_scope','year_range']` に写像し、`confirmedSlotsFromState` は `examPrepScope.yearRange` があれば `year_range` を confirmedSlots に入れる。後続ターンで AI が別 yearRange の `set_exam_scope` を返すと `confirmed-slot-overwrite` で reject される(上書き拒否自体は正しい)。
- 決定的 scope parser は yearRange 単独では scope を生成しない設計(`scope-parser-misparse-fix` で確定)。長文ターンで exam scope は AI 経路に委ねられる。

**喪失区間が実ブラウザで絞れている**: exam scope 長文ターン直後には対象年度は再質問されていない(= その時点では yearRange は state にある)。その後の **「バイト・睡眠・食事・風呂・過去問1年分3時間」をまとめた複合入力ターン**の後に、unit rate と対象年度の両方が missing として再質問された。つまり喪失は複合入力ターンで起きており、yearRange だけでなく unit rate も同時に失われた/入らなかった点が手がかり。

**直接原因は未確定。** 以下の候補仮説のどこで落ちるかを Phase 1 で実データ trace により確定する:

1. escalation されず AI が呼ばれなかった(そのターンで決定的 command が1件でも出て `madeProgress` になり、AI 抽出がスキップされた)。
2. `set_exam_scope` は accepted されたが、AI 応答の scope に `totalYears` はあるが `yearRange` が欠ける版が返り、`totalYears && !yearRange` で `year_range` が missing に追加された。
3. 後続ターンで yearRange なしの `set_exam_scope` が apply され、既存 scope の yearRange を上書き消去した(reducer は `examPrepScope: command.scope` で scope 丸ごと置換のため、部分更新ではなく消去になりうる)。
4. validator の value/shape チェックで scope が reject され、fields/priority だけ別命令で通った。

仮説3(scope 丸ごと置換による既存フィールド消去)が構造的に最も危険で、AI が同一トピックを別ターンで部分的に再言及すると既存 scope を壊す。

## 実装範囲

### Phase 1: 直接原因の確定(調査のみ・production 変更なし)

- 実ブラウザで観測した会話系列を、**複合入力ターンを勝手に分割せず、実際の会話系列を可能な限りそのまま再現**して pipeline で追う。特に喪失が起きた「バイト・睡眠・食事・風呂・過去問1年分3時間」の複合入力ターンを1ターンとして与える(役割ごとに分割しない)。そのターンの実 AI 応答(observ できたもの)を fake interpreter に固定する。実応答が未取得なら、複合入力に対して interpreter が返しうる候補(exam scope を再送するか、unit rate を返すか等)を複数パターンで検証する。
- **各ターン後**に `examPrepScope.yearRange` / `missing` / `confirmedSlots` / **accepted・rejected・parseRejections の各 command** を追跡し、複合ターンで yearRange と unit rate が同時に失われる/入らない瞬間を1点に特定して報告する。
- 特に確認する点: (i) 複合ターンで escalation が起きたか、(ii) AI が exam scope を再送し scope 丸ごと置換で既存 yearRange を消したか、(iii) unit rate が確定的 parser / AI どちら経路でも入らなかったのはなぜか、(iv) confirmed slot(year_range)により何かが reject されたか。
- 特定できたら、上記候補仮説のどれか(または別)を確定原因として Phase 2 の修正方針を確定する。

### Phase 2: 修正(Phase 1 の確定原因に応じて最小修正)

想定される修正(Phase 1 の結果で確定):

- 仮説3なら: `set_exam_scope` apply を **scope 丸ごと置換ではなく merge**(既存 yearRange/fields/totalYears を新 command が明示的に持つ値でのみ上書き、未指定フィールドは保持)に変える。
- 仮説2なら: AI/決定的いずれ由来でも「totalYears だけで yearRange なし」の exam scope を作らせない、または yearRange を confirm すべき slot として明示する。
- 仮説1なら: escalation の madeProgress 判定を「未消化の高価値 slot(exam scope/fields/priority)が残るターンでは、部分進展でも escalate する」方向に精緻化する(ただし `yearRange 単独受理の再設計条件`(r2c-eval 発見事項)と整合させ、範囲が escalation/validator 粒度の再設計に及ぶなら停止して報告)。

## 回帰テスト

- Phase 1 で特定した喪失シナリオを再現する intended test(現行 red)を追加し、修正後に yearRange が保持され対象年度が再質問されないことを固定する。
- 完全な exam scope(yearRange 込)→ 後続ターンで yearRange を含まない別トピック command、の系列で **yearRange が保持される**こと。
- 既存の exam scope 系 roleplay / foundation / edge cases が期待値変更なしで green。

## 完了条件

- 直接原因が1点に特定され報告されている。
- 修正後、AI 由来の yearRange がターンをまたいで保持され、対象年度の再質問が起きないことがテストで固定されている。
- 既存テストが全 green(placementScoring 既知1件を除く)、build 成功。

## 触らない範囲

- escalation / validator の粒度の**再設計**(仮説1が本命でかつ再設計が必要と判明したら停止して報告。最小修正で収まる場合のみ実施)。
- capacity 対応(120時間問題の容量側)、session chunking、生活制約の配置(別タスク)。
- AI interpreter の prompt/schema、renderer、UI。
- `state.range` と generator の planning window mismatch。

## 停止条件

- Phase 1 で原因が1点に特定できない、または複数ターンにまたがる複合原因のとき。
- 修正が escalation/validator の粒度再設計に及ぶとき。
- 変更が intake reducer / adapter と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
