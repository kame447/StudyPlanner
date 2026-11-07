# #977: VNext durable turn の送信回数

Status: measured regression baseline; no optimization adopted
Owner: Issue #977
Measured revision: `15937c92c2e6ca215c74f814bda8e4a7aeef264c`

通常ターンの2送信は、意味解釈と返信生成という異なる依頼だった。同一ターンの同時実行・完了後の再開・結果保存中断からの再実行で、追加のProvider送信は観測しなかった。重複送信の欠陥を実証できなかったため、削減実装は行わず、既存の保護を回帰テストにした。

## 測定の境界

`DurableTurnJob` → `executeDurableVNextJob` → VNext実runtime → durable provider → Workerの既存proxy処理を通し、upstream HTTPへの最後のfetchだけを計測用応答に置き換えた。正常な返信生成には既存のhealthy renderer fixtureを使用した。再開では同じstorageに新しいjob instanceを接続し、結果保存直前のstorage例外ではjournalを実際に再生した。

本番と同じコード経路を使うローカルの統合試験であり、実API E2Eではない。Pagesのdurable有効値はこの測定でreadbackしていない。選択可能なbrowser内runtime全体、実際の課金token、cached token、費用、p50/p95、実Providerの品質・失敗率を検証したとは扱わない。

## 9ケースの実測

| ケース | 論理dispatch | upstream送信 | 送信内容の区別 |
| --- | ---: | ---: | --- |
| 通常turn | 2 | 2 | native解釈＋renderer |
| 同一turnの同時accept/alarm | 2 | 2 | 実行中promiseを共有 |
| 完了後のaccept＋新instanceで再開 | 2 | 2 | 再開時の追加は0 |
| 結果保存中断後のjournal再生 | 4 | 2 | 再生した2dispatchの追加送信は0 |
| alarm前のcancel | 0 | 0 | cancelledのまま |
| owner不一致 | 0 | 0 | 元ownerのqueued状態を維持 |
| 解釈Providerの503 | 1 | 1 | 未保存の回復結果、追加送信0 |
| rendererの503 | 2 | 2 | native＋失敗renderer、追加送信0 |
| 保存checkpointからのfocused次turn | 2 | 2 | focused解釈＋renderer、native再読込なし |

各ケース内で、実際に送ったJSONのSHA-256を比較し、同一bodyの重複は0だった。通常の2依頼を、同じ利用者の一発話から来たという理由だけで同じ入力とは扱わない。owner/cancelの拒否や、完了不明時の再送禁止を最適化のために緩めていない。

測定時の完全なupstream JSON bodyは、通常turnでnative **71,535 bytes** / renderer **7,826 bytes**、focused次turnでfocused **3,438 bytes** / renderer **7,972 bytes**だった。messagesだけでなくschema等も含む送信bodyのbyte数であり、token数や課金額ではない。prompt/schemaの入力規模は残るコスト調査の手がかりだが、削減の可否・効果は未評価で、今回の範囲外とする。

## 回帰と残る範囲

回帰は `workers/ai-proxy/src/durableTurns/durableVNextProviderCalls.integration.test.ts` の9ケース。外部への送信段階と件数を固定し、保存済み結果の再利用、journal再生、owner/cancel拒否を実jobで確認する。byte数は将来の正当なschema変更を拒否する固定oracleにせず、今回の測定値としてのみ記録する。prompt本文や応答本文を新しいmetricsへ保存しない。

新しい欠陥は未確認なのでF/Sを割り当てて実装修正の根拠にしない。既存の安全な共有・journalを維持し、cache層、prompt、model、権限、承認・保存、retryの変更は0。Issue #977全体の実API・費用比較を完了したとは扱わない。
