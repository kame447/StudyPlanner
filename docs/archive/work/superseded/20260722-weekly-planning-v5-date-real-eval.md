# V5 date real-eval

Status: superseded / harness retained, evaluation scope consolidated
Superseded: 2026-07-28
Replacement: `../20260728-weekly-planning-stable-v5-verification-and-cutover.md`

旧taskはAlpha/V2 date schema向けharnessと、runner step開始前failureの記録である。実AI callは実行されておらず、評価完了ではない。

現在の採用対象はStable V5 production schemaである。非連続日、曜日集合、exact除外日のケースは保持しつつ、short answer、correction、availability、external source、authorization、previewまで含むactual AI real-evalへ統合した。

旧harnessを削除する必要はないが、このrecordをcurrent root taskとして実行しない。