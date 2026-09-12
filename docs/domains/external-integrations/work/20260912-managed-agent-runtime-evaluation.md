# Managed agent runtime：Agents APIの採否検証

Status: active provider assessment / documentation reviewed, experiment not executed
Updated: 2026-09-12
Provider owner: Issue #187
Product context owner: Issue #294

この文書は外部実行サービスの採否、利用条件、検証結果を所有する。記憶の正本・authority・forgetを再定義せず、[User Contextの委譲境界](../../user-context/architecture/managed-execution-boundary.md) をconsumeする。実装順は [User Context roadmap](../../user-context/roadmap/current.md) を正とする。Issue/PR/HEADと現在の文書検証は#294のcheckpointを参照し、本workの存在を実装着手とみなさない。

## 1. 公式情報で確認した範囲

2026-09-12に確認した [OpenAIの発表](https://openai.com/index/introducing-the-agents-api/) は2026-09-10公開で、Agents APIをpublic betaとして提供している。Codexのmanaged harnessを利用し、sessionの自動compaction、tool利用、subagent等を提供する。既存Agents SDKの単なる名称変更として扱わず、別の実行サービスとして評価する。顧客の改善事例をStudyPlannerでも得られる測定値にはしない。

[公式architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture) はOpenAI側のharness、実行environment、application serverを分離している。計算環境を必要としない `environment.type: "none"` も説明され、function toolはアプリ側で実行して結果を返す。したがって、すべての検証にsandboxや任意shellが必要なわけではない。一方、アプリの認証・tool handler・正式commitまでサービスが代行するとは解釈しない。

[公式overview](https://developers.openai.com/api/docs/guides/agents-api/overview) によると、public beta時点ではsession stateを保持し、sessionと公開artifactを削除できる。データ所在地は米国のみで、Zero Data Retentionに対応せず、自前sandboxでもその適格性は変わらない。API自体の追加料金がないことは、model token・tool・利用したsandbox等の費用がゼロという意味ではない。

この記録は上記確認日時の情報であり、採用直前に公式仕様を再確認する。対応modelの完全な範囲、strict schemaの詳細、正確な費用、細粒度の記憶消去、create要求の冪等性、全処理の観測・上限制御、任意のharness版固定は、この調査だけで確認済みにしない。

## 2. 比較対象と判断理由

選択肢Aは現在の直接モデル呼出しを維持し、必要最小限の実行処理だけを自作する方法である。移行リスクが小さく、現在のsemantic/renderer契約を維持しやすいためproduction baselineとする。ただし長時間処理に必要な復旧・圧縮が増えた場合、維持費用を実測する。

選択肢BはStable V5全体をmanaged agentへ置き換える方法である。正式状態や承認まで委譲する設計は既存contractに反するため採用しない。サービスの新規公開だけでは、現行の短い解釈・言い換え経路の置換根拠にならない。

選択肢Cは、会話横断episode抽出などの限定した読み取り専用jobを、同じ候補/validation境界の後ろでmanaged runtimeに実行させる方法である。これは条件付き比較候補とする。品質、費用、運用負担の改善があり、権限・訂正・忘却・復旧の必須条件を満たす場合だけ採用できる。非採用でも#294の記憶設計を取り消す必要はない。

## 3. UC-E0の検証契約

UC-E0は本work内の採否検証IDであり、新Issue番号でもAPI実装承認でもない。今回完了したのは公式資料の読解と設計への影響整理だけである。下記の実API、資格、privacy、費用、運用検証は未実施。

最初に、対象accountで使えるmodelとSDK/API版、strict入力出力、取消し・削除・結果取得、retention/residency、予算制御を確認する。利用条件が用途に適合しない場合はここで不採用にできる。ユーザーの資格情報をdocsやbrowser bundleに置かない。

次に、合成fixtureだけを使い、environmentなし、subagentなし、明示登録した読み取り専用functionだけで候補を生成する。実ユーザーのmemoryや会話は送らず、本番DBの書込toolを与えない。候補のvalidationとmutation policyへの接続はmockで確認する。実験用の鍵・課金上限・実行許可が用意されていなければ実験を開始しない。

同じ確定イベントと期待候補について、直接呼出しとmanaged実行を比較する。共通modelが利用できない場合は、model差を含む比較として報告する。日本語の好みだけで正式契約の違反を許容しない。母数、失敗、引分け、latency、全token/tool/sandbox等の利用量と、運用実装量を記録する。測定前に「安くなる」「賢くなる」とは決めない。

## 4. 採用前に通すfailure試験

ownerの不一致、偽のsession ID、scope外tool要求、存在しないsource IDを拒否する。role風文字列を含むmemory/tool出力が命令や承認に昇格しないことを#152のcorpusへ追加する。通常の承認・保存がagent出力だけでは成立しないことを固定する。

source revision Nを送信した後、N+1の訂正・forgetを発生させる。古い結果、compaction後の結果、遅延webhook、再接続時の結果を適用しないことを確認する。provider session内の部分失効を保証できない場合は旧sessionを利用終了し、現在の許可情報だけで新sessionを作る。古いsessionをforkしたり、古い要約を再投入したりして代替しない。

create応答の消失、eventの重複/順序逆転、handler停止、timeout、取消し直後の成功通知、結果不明を試す。アプリのoperation/receiptとprovider executionの照合を検証し、結果不明のまま第二sessionを作って二重実行しない。transportの認証・再送・保持の仕様を確認できなければ、その経路を採用しない。

制限された入力/tool集合で終わること、不要な追加読取が増えないこと、上限超過時に停止または安全に縮退することを確認する。利用量の欠落はunknownとして記録する。通常PR pushに有料実API検証を常設せず、既存の明示dispatch評価と整合させる。

session、artifact、ログの削除・保管の対象と確認方法を調べ、アプリのforgetの説明と一致させる。session削除要求の受理だけで全派生物の即時物理消去と主張しない。実ユーザーを使うpilotはprivacy/retention/residencyの判断、同意、security gate、運用上限が確定した後だけにする。

## 5. 採否の出口

必須条件はowner/scope隔離、正式stateへの直接writeなし、source/epoch失効、同一operationの一回適用、削除・保管条件の適合、予算と結果の観測、backend停止時の安全な復旧である。重大な失敗は平均品質や費用改善で相殺しない。

品質または維持費用の改善があり、必須条件がすべて満たされれば、限定purposeでの採用ADRとpilot範囲を記録する。一部の機能が観測・制御できない場合は用途をさらに狭めるか不採用とし、未検証を黙って通過させない。文書調査だけでは出口を通過しない。

## 6. Issueとの接続と変更範囲

#187はprovider採否・条件・adapter・障害時の縮退、#294はプロダクト記憶と文脈の意味、#164は共有状態/operation/outbox/移行、#152は攻撃/認可/失効の評価、#213は既存のusage・cost観測を所有する。#246で利用する場合のadvice/adoptionは#246のままである。#212の開発エージェント管理とは統合しない。

実行backendがmanagedでも、アプリの確定イベントとdispatch receiptは必要である。一方、managed内部のloop・compaction・session復旧まで並行して自作することは求めない。採用する場合のproduct portとforget/session境界はUser Context側の補助設計を参照する。

この変更は文書整備のみで、実API呼出し、provider切替、鍵追加、workflow変更、課金、本番データ送信は行っていない。新しい親Issue、実装branch、placeholder PRは作らない。再評価が必要になった時は同じworkへ確認日時と差分を追記し、完了時には継続する判断をownerへ移してarchiveする。
