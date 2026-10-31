# VNext conversation core: ownership, extension and scale

Status: supporting / experimental contract for Issue #926. Not the production runtime contract.

Stable V5 remains production. [Current V5 contract](current-contract-v5.md) owns production behavior; [Issue #926](https://github.com/kame447/StudyPlanner/issues/926) owns the current migration scope, exact verified commit, measured results and unresolved work. This document owns the VNext design intent, not a copy of changing progress reports.

## Why this core exists

V5の機能を全面的に再実装するためではない。意味の再解釈、派生値の保存、複数の更新経路、症状別の救済処理が同じ状態の責任を分担していたことを解消する。正常に動く期間解決・繰り返し展開・予定配置・文章生成・承認と保存は再利用し、V5の会話更新全体へ迂回しない。

一般化とは、個々の発話に専用条件を足さず、意味が確定した同じ操作には同じ規則を適用すること。すべての処理を一つの巨大な関数にまとめることでも、将来の仮想要件を先取りした汎用フレームワークを作ることでもない。

## One source of truth and one writer

利用者が述べた事実と明示した決定が正本である。残量や見積もりの計算結果は投影（読み取り用の計算）であり、利用者の明示値と同じ事実として保存しない。明示された残量と計算結果が矛盾する場合も、等式に合わせて明示値を勝手に変更しない。

処理の方向は「AIの意味解釈 → 型付きの差分 → 一回の原子的更新 → 一つの投影 → 既存の配置・表示・承認・保存」。rendererとJevは状態や保存の権限を持たない。副作用を伴うprovider・clock・calendar・checkpoint・plan repositoryはsessionの境界から注入し、domainの変換と投影は同じ入力に同じ結果を返す。

transaction内の作業用cloneを変更することは許容するが、呼出元のstateを変更してはいけない。拒否時は元のstate、同じturn keyの再適用は重複として扱う。純粋性を保つためだけに使い回さない小関数を大量に作る必要はない。

## Meaning belongs to the interpreter, mechanics to the application

対象、数量の役割、実績と将来の所要時間、単位変更、複数の独立した指示の解釈はAIの責務。コードの責務はIDと版の整合性、数学、操作の権限、原子的な適用、確定済みの意味に従う日付解決である。自然文を正規表現や数値の偶然の一致で再解釈しない。

値だけの訂正では他の欄を再生成しない。patchのnullは「変更しない」であり、消去とは異なる。参照先の同一性を変える場合は契約に沿って取消と新規追加を使い、単なる名前変更を新しい作業として扱わない。

同じ回答をanswerとdeltaで二重に適用しない。独立した別の指示を捨てて重複を隠すこともしない。意味的に同じだからという理由だけで任意の文書を混ぜる救済処理を追加しない。

## A transaction is ordered by dependencies, not by a convenient array loop

期間の追加・訂正・取消をすべて反映して有効な期間を先に確定し、その同じ最終期間で同ターンの日付を固定する。取消だけで期間がなくなる場合には、変更前の期間と既定の選択週を混同しない。将来の依存事実も、途中状態ではなく依存先の確定状態を読む。

その後に全ての明示的な変更を終え、新しい見積もりを最終の作業量・単位基準へ結び付ける。最後に全体の参照と値を検証して一回だけcommitする。「一つの関数に入っている」だけでは原子性や順序非依存の保証にならない。

S02の対照試験は、期間のpatchと取消＋新規指定が、同じ最終期間と締切を作ることを確認する。すべての操作が交換可能という主張ではない。取消後の再追加は別の系譜であることを保ちながら、等価な業務結果だけを比較する。

## Stable identity and the current read view

作業の系譜は名前や値ではなく、既存の置換履歴に由来する。取消後に同じ値を再追加しても別の系譜になる。見積もりは対象の系譜・量・数量基準に結び付き、対象が実質的に変わった後は無断で流用しない。

現在版への参照変換は `withCurrentVNextReferences` の一つの純粋な変換に集約する。配置とrendererの双方が同じ変換を使う。新しい参照欄を追加するときはここを更新し、両consumerで参照が届くことを試験する。表示専用の文章と配置専用の計算まで同じ関数に押し込まない。

## Accepted dates are evidence, not a fresh guess each day

今日・明日・来週などの単発の意味は、受理日の暦・週の始まり・最終的な計画期間を使って固定する。繰り返しの曜日フィルタは記号のまま期間内に展開する。単発の金曜締切と毎週金曜の規則を同じ再計算規則で扱わない。

V5移行では、既に受理した期間の根拠を保存されたgroundingから引き継ぐ。旧データの基準が不明な場合に現在の日付から推測してよいと一般化しない。移行・旧版への復帰で元のV5のbytesを書き換えない。

## The shown question is a presentation record

domainに未解決の質問があることと、利用者に質問を表示したことは違う。次の回答の結び付けは、実際の表示結果から一度だけ確定した質問・表示文・状態の版の組を使う。エラー通知を新しい質問の表示文として保存してはいけない（S01）。

自然な文章では選択肢の順序が変わることがある。「前者」の解釈は実際に表示した文へ結び付け、別のformatterから再構成した順序を使わない。表示が失敗した場合、未解決の質問はdomainに残っても「新しく表示済み」とはしない。古い提示への返事、別タブの更新、provider/renderer失敗を対照する。

## Repairs must have a small, explicit write set

形式修復は型検証が指した欄だけを取り込み、関係ない数量・対象・独立節を変更させない。意味の読み直しは別の操作として評価する。初回のAI出力全体が正解とは仮定しないが、確定した過去のstateを未検証の再生成で書き換えない。

同じ語彙・必須欄はschema、promptとvalidatorの共通定義から渡す。正常な意味を表せる表記の違いを不合格にするテストと、実際の誤更新を拒否するテストを区別する。修復・再試行は既存の有限回数契約を守り、失敗ごとに増やさない。

## Adding a fact family without adding another pipeline

まずV5の型、validator、calendar、scheduler、既存試験に対応する意味があるか確認する。必要な事実種類をtyped deltaとschemaへ足し、同じtransactionを通す。新しい権限・更新エンジン・別の正本は作らない。

拡張時には、追加・訂正・取消・同一ターン内参照、系譜と依存、checkpoint往復、providerの語彙、現在参照view、投影、予定配置、rendererの必要情報、traceで失われないことを確認する。全consumerに無関係なswitchを足す前に、共有の責任へ置けないかを判断する。型で閉じた対応表は網羅性を検査し、未知の欄を無言で無視しない。

既存の日付規則や学習ペースの意味がVNextの型で表現できない場合は、移植済みと呼ばない。機能の欠けとテストの未到達はIssueに残し、合格分母から黙って除外しない。

## Scale is several independent dimensions

予定とactive factsの数、同じ事実の訂正履歴の深さ、一つの作業内の候補数、期間内の繰り返し回数、provider入力量、checkpoint/trace容量、I/Oと同時更新を分けて測る。一つの小さな実APIコーパスの全成功は、これら全てのスケーラビリティの保証ではない。

索引を作る場合は一回の処理・同じrevisionの中に閉じる。古い計算を返すグローバルcache、履歴の無断削除、任意の利用上限、別サーバーや汎用frameworkの追加は初期解ではない。測定で重複走査が示された箇所だけ、同じ意味を保つ単純な索引や一回走査を検討する。

providerにはactive factsと投影の文脈が渡る。過去の全履歴を送らなくても、active factsが増えれば入力は増える。出力token上限は入力文脈の予算ではない。将来の文脈選択では対象、独立節、必要な依存を失わない対照試験が必要で、先頭N件への切捨てで成功率を作らない。

checkpointの既存2 MiB上限を超える可能性は、モデルの文脈上限とは別である。上限試験では既存の保存状態が壊れないことと利用者への回復経路を確認する。上限に未到達の小さな測定から容量を保証しない。ブラウザ・Firestore・複数端末の負荷/競合は、その実際の境界で別途確認する。

時間の測定は同じ版・条件で複数回行い、中央値と入力規模を記録する。CIの偶然の負荷を製品不良としないため、適切な場合は処理回数も測る。1000版などのstressを、実際の週間利用に必須の機能要件と偽らない。測定結果と根拠はIssue #926に置く。

## Comments and regression tests are a pair

コメントは「なぜこの順序か」「何を変える権限がないか」「どの不変条件を守るか」「どの試験がそれを守るか」を境界の近くで短く説明する。逐語的な処理説明や過去のケース名だけを増やさない。実装を変えるときは対応コメントと試験も同じ変更で照合する。

重要な性質は、入力順の変更、無関係な事実の追加、ID/表示名の変更、同等な更新表現、再送、取消と再追加、日跨ぎ、失敗後の復帰、保存・再読込でも維持されるかを試す。意図的に旧挙動へ戻したときに試験が失敗することも、有効な回帰の確認になる。実際に到達する経路と独立oracleを持たない反例を合格必須にしない。

主な実装入口は `weeklyPlanningVNextTypes.ts`、`semantic/weeklyPlanningVNextTransaction.ts`、`weeklyPlanningVNextWorkIdentity.ts`、`projection/weeklyPlanningVNextProjection.ts`、`application/weeklyPlanningVNextExperimentalSession.ts`。S01/S02/S03の履歴・probeと最新の閉鎖結果はIssueの監査記録を参照する。

## Adoption is a separate decision

この文書があること、ローカルの性質試験が通ること、モデルの合成コーパスで全問正解になることは、本番接続の許可ではない。最新の同一版に対する必要な型・単体・統合・実API・ブラウザ・保存/復元・trace・独立監査を確認する。Jevは解釈用の閉集合選択であり、採否と検証は独立の証拠に従う。本文を将来の未実装機能や無制限の規模の保証として読まない。
