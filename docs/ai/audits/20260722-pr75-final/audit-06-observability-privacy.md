# PR #75 七視点監査 6: trace、可観測性、プライバシー

監査対象は interpreter source、outcome、state mutation source、repair、candidate rejection、lifecycle event、fallback 記録、および trace 永続化データである。

trace は `interpretationSource=ai_interpreter`、`interpretationOutcome`、`stateMutationSource`、repair 実施有無、accepted/rejected/parse-rejection 数、provider または validation failure を別々に記録する。provider failure 時に `fallback_used` を記録せず、session の `hasFallback` も false のままであるため、AI 失敗と parser fallback を混同しない。

初回監査では、検証用の `interpreterRawResponse` 全文を trace event に永続化していた。AI 応答はユーザー入力の反復や、prompt injection による不要な文字列を含み得るため、診断価値に対して情報保持範囲が過大と判定した。

修正後は AI response 本文を永続化せず、`rawResponseLength` だけを記録する。parse rejection、failure category、accepted/rejected counts は維持するため、運用診断能力を損なわずに内容漏えい面を縮小した。回帰テストでは固有 marker を含む raw response が repository entry に現れないことを確認する。

判定は採用可である。trace の意味区分と最小化方針に blocker は残っていない。
