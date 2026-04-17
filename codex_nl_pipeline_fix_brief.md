# 自然言語予定入力 pipeline の現状問題点と Codex 修正方針

## まず押さえるべき問題

### 1. title 抽出が subject カタログに従属している
- `catalog.ts` の `inferCatalogTitle()` は `subjects[*].keywords` をそのまま舐めている。
- つまり title 候補がカタログ既知語に偏り、未知の教材名・課題名・テスト直し・学校ワークのような語を title として拾えない。
- その穴を埋めるために case-specific hardcode を足しやすい構造になっている。

### 2. compile 層が `contentText` をそのまま title fallback にしている
- `compile.ts` の `inferTitle()` は `inferCatalogTitle(contentText) ?? contentText` になっている。
- そのため `寝る前にだけ英単語の復習` のような文脈ノイズ込み文字列が title に落ちる。
- これは抽出失敗を隠してしまい、テスト上も「通ったように見える」ので改善が遅れる。

### 3. contentText の正規化が「イベント本体」と「文脈修飾」を十分に分離できていない
- `build-ast.ts` の `normalizeContentText()` は時制・日付・一部助詞は落とせるが、
  - `寝る前に`
  - `授業後に`
  - `帰宅後に`
  - `軽く`
  - `だけ`
  のような前置きが残りやすい。
- この段階で semantic body が汚れると、後段の title/subject 推定も全て弱くなる。

### 4. adapter で legacy fallback が再び title/subject を汚している
- `adapter.ts` の `inferLegacyTitle()` は `pipeline title -> contentText -> default title` で fallback している。
- `inferLegacySubject()` / `inferLegacyType()` は legacy 側の `detectSubject()` / `detectType()` に依存している。
- これにより pipeline を改善しても、最終出力で legacy hardcode の影響が残る。

### 5. テストが「一般化能力」ではなく「既知例の救済」を褒めている
- 現在のテスト群は `青チャート`, `システム英単語`, `情報の課題` のような既知例に寄っている。
- この構成だと Codex は未知ケースを抽象化するより、通らなかった例だけハードコードする方へ寄りやすい。

### 6. secondary issue: 絶対日付の構文が pipeline で十分扱えていない
- tokenizer は `4月15日` や `2026/04/15` を DATE token 化していない。
- 今回の主眼は title ではないが、実運用では「一部だけ legacy に戻したくなる」原因になる。

---

## 修正の原則

1. **subject 推定と title 推定を分離する**
2. **title は catalog 既知語に依存しすぎず、cleaned lexical candidate を第一候補にする**
3. **title 抽出に失敗したら raw content をそのまま title にしない**
4. **adapter 側で legacy fallback を最小化する**
5. **テストは未知語を混ぜて、hardcode では通らない形にする**

---

## Codex への修正要求

### A. `catalog.ts`
- `inferCatalogSubject()` は残す。
- `inferCatalogTitle()` は「catalog keyword を title として使えるときの補助」へ格下げする。
- 新しく `inferEventTitle(contentText?, contextText?)` を追加する。
- この関数では以下の順で title を決める。
  1. `contentText` / `contextText` を clean した lexical candidate を作る
  2. candidate 内に catalog 既知語の強い一致があればそれを優先
  3. そうでなければ cleaned candidate 自体を採用
  4. generic すぎるなら `undefined`
- 「subject prefix を落とせるが、落とした結果 generic になるなら元に戻す」ルールを入れる
  - 例: `英語のDUO3.0` -> `DUO3.0`
  - 例: `情報の課題` -> `課題` は generic なので元の `情報の課題` を維持

### B. `compile.ts`
- `inferTitle()` の `?? contentText` fallback をやめる。
- `inferEventTitle()` を使う。
- title / subject が取れなかった場合は `unresolvedFields` に反映する。
- compile 層は「構造化データを組み立てるだけ」に寄せる。

### C. `adapter.ts`
- `inferLegacyTitle()` の `contentText` fallback をやめる。
- `pipeline title -> inferEventTitle(contentText, rawText) -> buildDefaultPlanTitle(...)` の順にする。
- `inferLegacySubject()` は
  1. pipeline subject
  2. catalog subject
  3. legacy detectSubject
  の順に寄せ、legacy hardcode を最後の保険にする。

### D. `build-ast.ts`
- `normalizeContentText()` を少し強化する。
- 以下のような clause-leading adjunct を落とせるようにする。
  - `寝る前に`
  - `起きてすぐ`
  - `授業後に`
  - `帰宅後に`
  - `食後に`
  - `軽く`
  - `少し`
  - `だけ`
- ただし title 本体を削りすぎないよう、clean しすぎるロジックは `catalog.ts` 側の title helper に寄せてもよい。

### E. テスト追加
既知教材だけでなく未知語を混ぜる。少なくとも以下を追加する。

1. 未知教材名でも title が取れる
- `明日の7時から30分、英語のDUO3.0`
- title: `DUO3.0`

2. 文脈ノイズを title に含めない
- `毎晩寝る前に15分だけ英語のDUO3.0をやる。時間は23時で。`
- title が `寝る前にだけ英語のDUO3.0` にならないこと

3. generic な subject 単体には落とさない
- `夜は20時から1時間、情報の学校ワークA`
- title は `情報の学校ワークA` または `学校ワークA`
- 少なくとも `情報` 単体にはしない

4. 既知例も維持
- `青チャート`
- `システム英単語`
- `現代文`

5. hardcode 回避用
- テスト名にも具体教材名だけでなく `unknown workbook title` 系を入れる
- 1ケースを通すためだけの if/switch では全体が通らないように複数未知語を混ぜる

---

## 実装でやってはいけないこと
- `if (text.includes("青チャート")) return "青チャート"` のような語彙追加だけで済ませる
- `contentText` をそのまま title fallback に戻す
- pipeline の最終値を adapter で再び legacy hardcode に強く依存させる
- 既知例テストだけ増やして unknown case を増やさない

---

## 期待する完成形
- title は未知語でもそこそこ拾える
- subject は catalog ベースで安定しつつ、title は lexical heuristic で広く拾える
- compile と adapter で二重に title/subject を再推定しない
- Codex が例外ハードコードではなく helper 関数の改善に向かう
