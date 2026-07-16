# 週間計画のpending range契約修正と敵対的QA反復

## 対象

対象リポジトリは `kame447/StudyPlannner`、対象ブランチは `agent/weekly-planning-conversation-hardening` である。

指摘対象headは `f8cb53919d6678be3a7491ad0f938c82d17c1669`、比較元は `74185277d68b5dee37560a9c0a79356f837bc5f2` である。作業開始時、対象ブランチのHEADは指摘対象headと一致しており、既存変更のresetまたはcheckoutによる破棄は行っていない。

## 今回の問題

named future periodを部分回答から具体的なplanning rangeへ昇格させる処理で、選択可能期間の境界とユーザーが選択した開始日が同じ `scope.startDate` に格納されていた。この二義性により、開始日保存後も開始日を再質問する、期間だけの回答で境界開始日を選択済み開始日として利用する、境界外日付を上書きできる、AI・storage・parser間でfieldの意味が変わる、という不整合が生じていた。

また、pendingが存在するだけで発話中の日付・期間を部分回答として採用していたため、引用、伝聞、第三者の希望、例文、提出日、タスク自体の所要期間がplanning rangeへ流入する経路があった。storageの日付fieldも単なるstringとして受理され、実在しない日付や逆順rangeを復元可能であった。

## 修正対象

今回変更する直接経路は、intake state型、missingと質問slot、deterministic parser、command adapter、AI schema、AI prompt、AI runtime validation、candidate validator、state summary、pipeline、storage validator、storage復元、関連テストである。

## 対象外

週間計画対話全体の再設計、AI会話品質全般、無関係なrenderer文言、他slotの一括改名、汎用日本語構文解析器、storage schema全体の全面移行、無関係な型整理、性能最適化、既存警告とtodo、汎用QA基盤の新設は対象外とする。

GitHub Actionsが最小workflowでも起動しないrepository設定または権限状態は今回のコード主題ではないため、対象外の基盤事項として記録する。一時workflowとissueは検証後に削除する。

## 採用したstate契約

pending scopeは次の意味へ分離する。

```ts
type PendingPlanningRangeScope =
  | {
      kind: 'next_week';
      label: string;
      windowStartDate: string;
      windowEndDate: string;
    }
  | {
      kind: 'named_future_period';
      label: string;
      windowStartDate?: string;
      windowEndDate?: string;
    };

interface PendingPlanningRangeClarification {
  scope: PendingPlanningRangeScope;
  planningStartDate?: string;
  durationDays?: number;
  sourceText: string;
}
```

`windowStartDate` と `windowEndDate` は選択可能期間の境界だけを表す。`planningStartDate` はユーザーが選択した開始日だけを表す。`durationDays` は計画日数だけを表す。一つのfieldを複数の意味に再利用しない。

`planningStartDate` と `durationDays` の両方が揃ったpendingは保持しない。deterministic parserは直ちにrangeへ昇格し、runtime validator、candidate validator、storage validatorは解決済みpendingを拒否する。

`next_week` のwindowはcommand adapterが必ず補完する。`named_future_period` のwindowは既知の場合だけ保持し、片側だけのwindowは拒否する。

日付は `YYYY-MM-DD` 形式だけでなく実在する暦日であることを検証する。windowは開始境界以下終了境界、選択開始日はwindow内、durationは有限のsafe positive integer、確定rangeは実在するdatetimeで開始以下終了とする。既存仕様の `T24:00:00` は許可する。

named future periodのrange終端をwindow内へ強制する根拠はroadmapと関連実装から確認できなかったため、勝手に仕様を追加しない。今回確定する境界条件は、少なくとも選択開始日自体がwindow内であることである。終端越境の可否は未確定事項として残す。

旧storageの `scope.startDate` / `scope.endDate` は境界か選択開始日かを判別できないため、推測移行せずsession全体を拒否する。

## 質問契約

`planning_duration` を独立missing slotとして追加する。開始日未入力なら `planning_start_date`、日数未入力なら `planning_duration` をmissingにする。

開始日と日数の両方が不足している初期pendingでは、質問依存関係により開始日の質問だけを表示する。開始日保存後は期間の質問だけ、期間保存後は開始日の質問だけを表示する。questionsと `lastQuestionContext.targetSlot` は実際に不足しているslotと一致させる。

期間質問は `夏休みの計画は、開始日から何日間にしますか？` とする。

## parserの採用条件

pending部分回答は、発話が短答として妥当な形状である場合、または直前の `lastQuestionContext` が該当slotを質問し、planning request signalを含む回答として解釈できる場合に限る。

開始日短答は月日または曜日開始、期間短答は一週間、1週間、7日、7日間を今回の範囲で受理する。

引用符内、伝聞、第三者主体、例文、引用、教材、問題文、学習内容の説明はplanning period変更として扱わない。提出日、締切、期限、固定予定の日付はplanning startとして扱わない。終わらせたい、かかる、必要、所要時間に係る期間はplanning durationとして扱わない。

本人による `夏休みじゃなくて来週にしたい` と `夏休みではなく来週の計画を立てたい` は維持する。

## 受入条件

夏休みから8月1日と回答した状態では `planningStartDate=2026-08-01` を保存し、次のmissing、questions、lastQuestionContextを `planning_duration` とする。

夏休みから一週間と回答した状態では `durationDays=7` を保存し、次のmissing、questions、lastQuestionContextを `planning_start_date` とする。

両順序とも `2026-08-01T00:00:00` から `2026-08-07T24:00:00` の同一rangeへ昇格する。

window境界だけでは選択開始日を補完しない。window外の10月1日は採用しない。引用・伝聞・第三者・例文による来週変更を採用しない。タスクの提出日とタスク所要期間をpending回答へ流用しない。

v2とlegacyの新shapeはreload後の継続turnでrangeへ昇格する。旧二義的shape、不正日付、逆順window、window外開始、非正整数duration、解決済みpending、不正確定rangeは拒否する。

## 追加・変更したテスト

`weeklyPlanningPendingRangeContract.test.ts` を追加し、質問UI、missing、lastQuestionContext、入力順序、window境界、引用・伝聞・学習説明・第三者・例文、本人の直接変更、無関係な提出日・所要期間、短答回帰を固定する。

`weeklyPlanningPendingRangeCommandContract.test.ts` を新契約へ更新し、adapter補完、runtime validation、field組合せ、解決済みpending拒否、実在日付、window外開始、両順序の昇格、巨大durationによるNaN防止、next_week回帰、夏休み宿題回帰を固定する。

`weeklyPlanningPendingRangeStorageContract.test.ts` を追加し、v2とlegacyのstart-only・duration-only reload後継続turn、不正pending、不正確定range、旧field名拒否を固定する。

既存テストは削除しない。旧契約を期待するテストは意味を新契約へ更新する。

## 敵対的レビュー反復1

反復番号: 1

QA観点: QA1、QA2、QA4、QA5、QA7

severity: MAJOR

対象箇所: intake types、reducer、question slot、parser、storage

再現条件: 夏休みpendingへ8月1日から、または一週間を部分回答する。

期待結果: 入力済み要素を保存し、反対側のslotだけを質問し、両方が揃えばrangeへ昇格する。

現在の結果: `scope.startDate` が境界と選択開始日の二義を持ち、reducerが常に `planning_start_date` をmissingへ追加していた。

根拠: 対象headの型、reducer、parser、question registry、storage validatorの実コード。

今回の主題に含まれるか: 含まれる。

対応方針: window境界、選択開始日、日数を独立fieldへ分離し、`planning_duration` slotを追加する。

## 敵対的レビュー反復2

反復番号: 2

QA観点: QA3、QA4、QA7

severity: MAJOR

対象箇所: 初期review patchのruntime validatorとparser除外条件

再現条件: window未指定のnext_week AI payload、または正当な短答に数学ワークという語が含まれる入力。

期待結果: adapter補完前のnext_week payloadは他fieldを検証した後に正規化し、タスク関連語だけで正当な回答を拒否しない。

現在の結果: 初期patchではnext_week window省略時の早期returnにより、planningStartDate形式と解決済みpendingの検査を飛ばせた。また、教材名そのものを除外条件にすると正当な回答まで拒否した。

根拠: review patchの制御フローと具体的な反例。

今回の主題に含まれるか: 含まれる。

対応方針: 早期returnをwindow補完に必要な一点だけへ遅延し、日付・duration・解決済みpending検査を先に行う。除外は教材名ではなく提出日、締切、所要時間など発話中の意味役割へ限定する。

## 敵対的レビュー反復3

反復番号: 3

QA観点: QA3、QA5、QA7

severity: MAJOR

対象箇所: 初期review patch、日数上限、named period終端

再現条件: 対象head原本へpatch適用、366日超のduration、window内開始かつwindow外終了のrange。

期待結果: 対象headへ正確に適用でき、既存仕様に根拠のない制約を追加しない。

現在の結果: 初期patchは4ファイルでhunk不一致があり、対象head原本とずれていた。366日上限とrange終端のwindow内強制には既存仕様上の根拠が確認できなかった。

根拠: 対象head blobとの照合、`git apply --check`、roadmap・関連test・実装の確認。

今回の主題に含まれるか: patch不一致は含まれる。根拠のない追加仕様は採用しない。

対応方針: 対象headの実ファイルから変更を再生成する。durationはsafe positive integerとし、range生成時に実在日付を再検証する。選択開始日のwindow内だけを確定条件とし、終端越境可否は未確定事項へ記録する。

## 敵対的レビュー反復4

反復番号: 4

QA観点: QA1からQA7

severity: REVIEW

対象箇所: 新契約の全直接経路

再現条件: 必須対話、逆順入力、短答連続、境界外・不正・巨大値、引用・伝聞、state全field、v2・legacy reload、next_week回帰、型・prompt・validator・storage横断確認。

期待結果: 全レイヤーが同じfieldを同じ意味で扱い、再現可能な主題内問題が残らない。

現在の結果: 静的契約確認と専用contract checkでは主題内の追加問題は確認されていない。`git diff --check` はローカル再構成差分で成功した。部分的なTypeScript検査では、再構成していない既存モジュールの解決エラー以外の直接型不整合は検出されなかった。

根拠: 対象headから再構成した変更ファイル、27件の契約assertion、追加テスト、field横断確認。

今回の主題に含まれるか: 含まれる。

対応方針: 対象branchへコード・テスト・本記録を反映し、可能な検証を再実行する。未実行検証を成功扱いにしない。

## 対象外の発見事項

GitHub Actionsは、push、pull_request_target、issues、および最小issue smoke workflowのいずれでもrunを生成しなかった。repository設定またはGitHub App起点イベントの制約と考えられるが、今回のplanning rangeコードとは独立しているため修正しない。一時workflowとissueは削除する。

PR #5には今回以外の大きな既存差分が含まれる。今回の変更へ混ぜて修正しない。

## 検証記録

実行済み:

`git diff --check`: PASS。対象headから再構成したローカル差分で確認した。

専用contract check: 27 assertions PASS。日付、window、duration、解決済みpending、引用・伝聞、短答、入力順序、NaN防止を確認した。

部分TypeScript検査: 変更ファイル間の直接型不整合は検出されなかった。再構成していない既存moduleのTS2307だけが残ったため、全体typecheckの代替とはしない。

未実行:

focused Vitest、週間計画関連全テスト、全テスト、`npm run build`、比較元から現在HEADまでの最終 `git diff --check`、最終 `git status -sb`。実行環境に完全なprivate repository worktreeがなく、repositoryのGitHub Actionsも起動しなかったためである。未実行項目をPASSとは記載しない。

## 未解決事項

named future periodの選択開始日から生成したrangeがwindow終了境界を越えることを許可するかは、既存仕様から確定できていない。今回の最低保証として開始日自体のwindow外を拒否する。終端越境の契約変更は根拠を得た別タスクで行う。

完全なrepository環境でのfocused tests、週間計画関連全テスト、全テスト、buildは未実行である。コードとテストは追加したが、これらが成功するまで検証完了とは扱わない。
