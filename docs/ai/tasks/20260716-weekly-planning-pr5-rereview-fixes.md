# PR5 再レビュー指摘を修正する

Status: closed
Created: 2026-07-16
Closed: 2026-07-16

## 目的

PR #5 の head `068e728` に対する再レビューを実装とテストに照らして検証し、妥当な指摘を重要度順に解消する。非同期turn、storage境界、reducer不変条件をUI lifecycleから分離し、session contractとして固定する。

## レビュー妥当性

再レビューの B1、M1、M2、M3、N1、N2、N3 はすべて妥当と判断した。

B1はpreview候補がcomponent-local stateだけに存在し、modal unmount後に完了したPromiseの結果をsessionへ保持できない問題である。M1はstorage validatorがnested intake、draft、metadataを閉じて検証していない問題、M2はload時にsession-localなassumption proposal ledgerを除去していない問題である。M3はstale identityとpending中のmutation guardをproperty testが十分に固定していない問題である。

N1は期間開始前日から跨ぐ予定がoccurrence展開対象へ入らない問題である。N2は`durationDays`の型、AI schema、runtime、実際の未確定状態が一致していない問題である。N3は責務別testとcatch-all review testの重複である。

## 確定方針と実装結果

### 1. previewをsession ownerへ移す

`commit_turn`でintake state、assistant message、preview候補を原子的に保存する。preview候補はPlanningStateとlocalStorageへ保持し、modalをpending中に閉じてもturn完了後の再mountで復元する。

NaturalLanguageAssistantはpreviewのownerではなく表示・操作controllerとする。個別削除、全破棄、draft昇格、session resetはreducer actionへ統一した。modalが存在しない間にturnをcommitし、再読込後にpreviewと昇格操作が表示されるintegration testを追加した。

### 2. storage境界を閉じたvalidatorとsanitizerへ統一する

PlanningIntakeStateのunion、配列要素、nested object、optional fieldを明示的に検証する。WeeklyPlanDraftBlockとpreview候補はPlanType、日時、source/status、optional material fields、behaviorMetadata、previewMetadataを検証する。

current v2 envelopeとlegacy migrationを同一sanitizerへ通す。不正なintake、draft、previewは部分採用せずsession全体を初期化する。pendingTurn、pendingApproval、assumptionProposalRecordsはload結果から必ず除去する。

### 3. reducer property contractを全actionへ拡張する

requestId、weekStartDate、baseRevisionを独立に一致・不一致化するgeneratorへ変更した。pending turn中とpending approval中は、対応する終端action以外のnon-load actionが同一参照を返すことを検証する。

受理されたmutationはrevisionを正確に1増やし、拒否されたmutationは同一参照とrevisionを維持する契約を固定した。

### 4. fixed-event occurrenceの展開範囲を前日へ広げる

occurrence展開開始日をrange開始日の1日前へ広げ、最後にdatetime overlapで絞り込む。前日開始の単発予定と繰り返し予定を回帰テストへ追加した。

### 5. durationDaysの契約を実際の未確定状態へ合わせる

AI command payloadとnormalized commandを分離したうえで、PendingPlanningRangeClarificationの`durationDays`はoptionalとした。これは`named_future_period`が期間名だけ確定し、日数は未確定の状態を正しく表すためである。

`next_week`はadapterで7日へ正規化し、storage validatorでも正の整数を必須とする。`named_future_period`は日数未確定を許し、明示された日数だけを保持する。runtime validatorは不正なkind、0以下、小数をcommand境界で拒否する。schema、runtime、domain、storageの契約をこの区別へ統一した。

### 6. 重複testを責務別fileへ集約する

command shapeはruntime validation test、scope競合とenrichmentはscope enrichment test、単一分野から複数分野への遷移はsingle-field priority testへ集約した。ReviewCoreFixesは複数境界を横断する最小限のintegration caseだけを残した。

## 最終検証

`git diff --check origin/main...HEAD`は成功した。

全テストは104 files passed、1 skippedである。testsは1003 passed、13 skipped、5 todo、合計1021である。

`npm run build`は成功した。警告は既存のdynamic/static import重複と500kB超chunkのみであり、今回の修正による新規build errorはない。

## 完了判定

modal lifecycleを跨ぐpreview復元、malformed storageの全体拒否、session-local fieldの除去、identity別property contract、前日開始予定の抽出、durationDays契約統一、test重複整理を完了した。再レビューで採用不可の根拠となったBLOCKER、MAJOR、MINORはすべて解消済みである。
