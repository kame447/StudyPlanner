# PR #75 七視点監査 1: アーキテクチャと責務境界

監査対象は PR #75 の production entry point `weeklyPlanningTurnExecutor.ts` から到達する依存グラフである。目的は、ユーザー発話の意味解釈を AI interpreter だけに限定し、決定論的パーサー、legacy fallback、test support が本番経路へ混入しないことを確認することである。

初回監査では、executor 自体から rules 分岐は削除されていたが、draft candidate generator から session chunking、daily distribution を経由して `parsing/weeklyPlanningText.ts` へ到達する依存が残っていた。実際の意味解釈分岐ではなくても、本番 bundle の依存としてパーサーが残るため、要求を満たさないと判定した。

修正では、タスクプロファイル既定値を `profiling/studyTaskProfileDefaults.ts`、分数配分の純粋関数を `scheduling/minuteDistribution.ts` へ分離した。session chunking はこれらの中立モジュールだけを参照し、文字列パーサーを含む daily distribution への依存を外した。

最終の再帰 import 検査では、executor から到達する 68 モジュールのうち、`/parsing/`、`Parser`、`Parsing`、`Legacy`、`.testSupport` に該当するモジュールは 0 件であった。production executor、behavior pipeline、intake pipeline に legacy user-turn reducer または parser fallback の呼び出しも存在しない。

判定は採用可である。責務境界に blocker、major、minor は残っていない。
