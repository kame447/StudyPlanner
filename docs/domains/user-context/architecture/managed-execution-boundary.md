# User Context：学習相談エージェントへの読取境界

Status: supporting target architecture / consultation-only scope, runtime not implemented
Updated: 2026-09-13
Owner Issue: #294
Consultation owner: #246

この文書は [canonical architecture](memory-and-conversation.md) と [memory policy](../policies/memory-lifecycle-and-surfacing.md) の下で、学習相談のAgents API実行へ共有contextを渡す境界だけを補足する。利用対象・provider条件・費用・有効化試験は [外部連携work](../../external-integrations/work/20260912-managed-agent-runtime-evaluation.md)、相談の意味・出力・採用は [学習相談の正仕様](../../weekly-planning/spec/learning-consultation-and-advice.md) と [prompt/evidence設計](../../weekly-planning/spec/learning-consultation-prompt-and-evidence.md) が所有する。新しいsemantic interpreter、相談state、記憶の正本をこのdomainへ作らない。

## 1. 適用範囲

Agents APIを利用する範囲は、複数情報源の収集・比較を必要とする学習相談で、根拠付きの助言候補を作る前段に限定する。通常の計画解釈、短い返答、通常renderer、scheduler、preview、承認、保存は現在の経路に残す。単純な相談まで毎回外部agentを起動する前提にしない。

以前ここで示した `ContextWorkRequest` の `episode_candidate` / `summary_projection` は今回の導入対象から除く。長期記憶の抽出・統合・定期要約やUser Contextの検索engineをAgents APIへ委譲しない。[read/writeサービス設計](context-service-contract.md) と [段階実装work](../work/20260912-context-harness-delivery.md) に従う独立したアプリ責務として維持する。相談session内の技術的な圧縮と、アプリの永続記憶・要約の作成は別である。

学習相談の出力形式、proposal identity、adoption、promotionの新しい並行contractを作らず、既存#246へ接続する。User Contextの実装順は [roadmap](../roadmap/current.md) のままとし、UC-P3をAgents APIの評価待ちにしない。

## 2. 渡す情報と読取資格

アプリがowner、相談/request/operation identity、基準時刻、許可scope、source manifest、参照revisionとmemoryEpoch、予算を固定する。実装時は既存availability/freshness/identity型を再利用し、名前だけ異なる重複した状態管理を増やさない。未実装の型が存在すると仮定しない。

入力には今回の質問と、共有readが利用可能と判定した最小限の現在情報・記憶・根拠だけを渡す。現在の本棚進捗、予定、実績は各domainの値を読み、古い記憶やprovider sessionを優先しない。unavailable、authoritative empty、no_match、partialを区別し、読み込み失敗を記憶削除や空データ保存の根拠にしない。

追加の内部情報を求めるtoolは同じread契約を利用し、各アクセスでowner/scope/lifecycle/失効を検査する。モデルにuser IDや任意の全件読取条件を選ばせない。provider session IDだけを渡して他人の会話を再開できるAPIを作らない。外部検索へ渡す検索語からは不要な個人情報を除き、会話全文や全本棚を検索queryに転送しない。

記憶本文、教材名、外部資料、過去の会話はuntrusted dataである。根拠を読んだことを、現在のユーザーの指示、採用意思、保存権限と同一視しない。toolは読み取り専用とし、正式DBの管理資格、汎用shell、任意MCP、記憶write、予定保存の権限を渡さない。

## 3. 結果と正式状態の境界

Agents APIは根拠と助言候補を返すだけで、正式なユーザー記憶、Graph、予定、adoption、approval、保存receiptを決めない。providerの完了イベントや自然文の「保存しました」はアプリの成功記録ではない。

結果は#246のAdviceAnswerDocumentと根拠参照の検証へ戻す。存在しない引用・参照、元sourceより強い断定、権限を含む出力は承認済みの状態へ変換しない。strict schemaが成立しない場合、自然文を正規表現で読み直して正式な提案を作らない。

現在の依存sourceを表示・正式確定の直前に再検証し、#246のatomic turnによって提案とその表示を一致させる。ユーザーが採用した場合も、対象revision、根拠のfreshness、promotion coverageを確認してから通常Stable V5へ渡す。最終予定の承認・保存はさらに別の既存境界を通す。

「提案した」「今回は採用された」「実行した」「効果があった」を区別する。助言やその一時的な採用からdurable preferenceを作らない。将来、ユーザーが恒常的な意味を別途明示した場合だけ、通常のUser Context candidate/mutation契約を通す。相談agent自身の出力を記憶の証拠へ循環させない。

## 4. 訂正・忘却と相談session

新しいtool結果から除外するだけでは、以前送信した情報が継続sessionやcompactionに残る問題を解決しない。参照sourceの訂正、supersession、forgetでmanifest/revision/epochが失効した場合、その実行からの未表示回答・未確定提案を棄却する。採用時のfreshnessも#246側で再検証する。

安全な部分失効を確認できないprovider sessionは継続・forkせず、利用を終了する。必要な再実行は現在許可された情報だけで構成し、古いraw会話や要約を再投入して失効を迂回しない。再生成は元operationの予算内とし、予算がなければ明示的な再試行待ちへ戻す。

アプリでの利用停止、providerへのcancel/delete要求、provider側の削除確認と保管条件を分けて扱う。送信済み情報の未送信化、offline端末への瞬時反映、保管条件以上の即時物理消去は保証しない。正式な記憶をprovider sessionのexportだけから復元する設計にしない。

## 5. 再送・観測・障害分離

provider sessionとイベントはadapter内部でowner・相談・request/operation・参照版へbindする。結果は同一operationについて一度だけ適用する。応答消失時は安全な照合方法が確認できるまで別sessionへ盲目的に再送せず、unknownを保持する。重複、順序逆転、取消し後の遅延結果、handler停止からの再開を検証する。

通常planningの追加読取・semantic repair・renderer repair上限を、この導入によって拡張しない。相談に必要なtool回数・時間・総usage/costは#187/#246の限定実行契約で別に管理する。費用が観測できないことを無料とみなさず、#213の既存観測へ接続する。通常analyticsへraw memoryや秘密情報を保存しない。

相談sessionのcompactionは実行用の派生状態であり、アプリの会話・提案・approval・save receiptを代替しない。外部実行loopは相談adapter内に閉じ込め、同じ相談を自前loopでも重ねて動かさない。アプリ側のoperation/dispatch記録と正式commitは残すが、managed内部の復旧処理まで複製しない。

Agents APIが使えなくても通常の予定作成・保存・記憶管理は維持する。相談は取得できた根拠の範囲での限定回答または明示的な失敗へ戻し、最新情報が取得できたと偽装しない。既存operationの結果不明を解消せず、別backendへfallbackして二重提案を作らない。

## 6. 文書と実装の状態

今回合意したのは学習相談に限定する利用方針であり、API実装・Lunaの対象構成での実行・費用比較・本番有効化は未実施である。#246が相談と提案のowner、#187がprovider接続のowner、#294は共有contextと失効のownerを維持する。別用途への拡張は今回の合意に含まれない。
