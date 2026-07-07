# 【最優先】AI candidate ラッパー契約の簡素化(candidates: command[] 化+寛容パース)【完了 2026-07-05】

> **完了記録**: 実装・採用・コミット済み。継続対話スモークで実 AI の bare command 応答(set_exam_scope / set_priority_policy)が parser → validator → reducer を通過し、**AI 経路が初めて end-to-end で成功**した。R2-D 着手条件のもう一方(scope parser 修正)も完了済み。残る前提は `20260705-weekly-planning-zero-progress-draft-request.md`(open)の完了とスモークでの draft 到達確認。

継続対話スモークで、AI が完全な command payload を返したにもかかわらず、candidate ラッパーの `needsConfirmation` が top-level に位置ずれしただけで**全候補が破棄**される回帰が確認された。ラッパー契約を簡素化し、この種の位置ずれ・欠落で payload が失われないようにする。

**R2-D の着手条件**: 本タスクと scope parser 修正(`20260705-weekly-planning-scope-parser-misparse-fix.md`)が完了し、**継続対話スモークで exam scope と unit rate が両立すること**を確認してから。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 背景(調査で確定済み)

- 観測された実応答: `{"candidates":[{"command":{...完全なset_exam_scope...}},{"command":{...完全なset_priority_policy...}}],"needsConfirmation":false}` — `needsConfirmation` が candidate 単位ではなく top-level に1個。
- schema と parser の契約自体は整合している(どちらも candidate 単位の needsConfirmation を要求)。**AI が strict: false の下で契約から逸脱した**のが原因であり、schema 完全化では防げないドリフト。
- 全候補が parser の needsConfirmation チェックで `invalid-candidate-shape` に落ち、validator / reducer に到達しなかった。

## 採用する方式(判断済み)

**`candidates: command[]` への簡素化を採用する。** 理由:

- `needsConfirmation` は validator 内で `confidence === 'medium' || candidate.needsConfirmation || 未知field` の OR 入力であり、**confidence とほぼ冗長**。AI に別フィールドとして書かせる価値が薄い一方、ラッパー階層は契約違反の攻撃面積になっている。
- 外部契約(schema / AI 応答)からラッパーを消し、**内部型は変えない**: parser が bare command を受けて `InterpretedCommandCandidate` を組み立て、`needsConfirmation` は **confidence から導出**(`medium` → true、それ以外 → false)する。validator・pipeline・fake の内部インターフェースは無変更で済む。
- あわせて**寛容パース**: 旧形(`{ command, needsConfirmation }` ラッパー)で返ってきた場合も受理する(needsConfirmation があれば尊重、なければ導出)。モデルのドリフトの両方向に耐える。

## 実装内容

1. **schema**: candidates の items を command union(既存 `WEEKLY_PLANNING_COMMAND_SCHEMAS` の anyOf)そのものにする。ラッパー object と needsConfirmation を schema から削除。
2. **prompt**: needsConfirmation への言及を削り、「candidates は command オブジェクトの配列」と整合させる。品質チューニングはしない。
3. **parser**: bare command / 旧ラッパーの両形を候補単位で受理。`needsConfirmation` は「ラッパーにあれば尊重、なければ confidence==='medium' から導出」。構造不正は従来どおり候補単位で `parseRejections` へ。
4. **schema 完全性テストの追随**: 既存の完全性テスト(KNOWN_COMMAND_TYPES との対応)が新構造でも機能するよう更新(検査位置の変更のみ。意図の変更なし)。

## 回帰テスト(red → green)

- **今回の実応答(top-level needsConfirmation)を fixture 化**し、修正後は両 command が生き残って validator を通過することを固定(現行では red になる intended test)。
- bare command 配列(新契約どおり)の応答が受理されること。
- 旧ラッパー形の応答も受理されること(寛容パース)。medium confidence → needsConfirmation true の導出。
- 構造不正候補(type なし等)は引き続き候補単位で parseRejections に落ちること。
- 既存テスト(foundation / mock / schema 完全性 / regression)は期待値変更が「ラッパー形の fixture 更新」に閉じること。それを超える期待値変更が必要になったら停止して報告。

## 対象ファイル候補

- `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`(schema / prompt / parser)
- `src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts`(fixture・導出テスト)
- 必要なら `weeklyPlanningInterpreterFoundation.test.ts` の fake 応答形の追随(機械的変更のみ)

## 触らない範囲 / 停止条件

- `InterpretedCommandCandidate` / validator / pipeline / escalation / renderer / UI / proxy / domain 型。strict: true 化。prompt 品質チューニング。
- 内部型の変更が必要になったら停止して報告。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
