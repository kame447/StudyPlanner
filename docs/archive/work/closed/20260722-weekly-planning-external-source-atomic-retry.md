# 外部予定取得のatomic success/failureとretry

Status: closed / pure module implemented and automated verified
Closed: 2026-07-28
Implemented by: PR #77

## 完了内容

- `success(events) | failure(reason)`へ限定
- empty successとfailureを区別
- partial resultを上位へ公開しない
- temporary failure/exceptionのbounded retry
- auth、permission、not configured、invalid responseの非retry
- owner mismatch・不正eventのsource単位reject
- failureを予定0件として扱わない
- failure時もconversationとaccepted factsを維持
- source要求中は取得成功前に最終previewへ進めない
- semantic tests、Worker routing、TypeScript、production build成功記録

## 残件の移管

production calendar adapter、pagination、実認証、metrics、browser verificationは次へ移管した。

- `../20260728-weekly-planning-external-source-production-adapter.md`

pure loaderの実装taskとproduction adapter rolloutを同じopen taskとして残さない。