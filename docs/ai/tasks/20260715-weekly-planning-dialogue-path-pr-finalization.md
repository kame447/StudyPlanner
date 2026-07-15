# 週間計画の対話経路PRを最終検証して終了する

Status: open
Parent: `20260715-weekly-planning-dialogue-path-issue-breakdown.md`
Depends on: `20260715-weekly-planning-dialogue-path-implementation-cleanup.md` closed

## 背景

PR #3は挙動修正の検証を通過しているが、構造整理前の一時構成と検証用baseを使用している。構造整理後の最終差分を基準に、検証とPR終了処理を行う。

## 作業範囲

- PRのbaseを`main`へ戻す
- PRタイトルから検証中表記を外す
- PR本文を最終差分と検証結果へ更新する
- 変更ファイル一覧からtask外の変更と一時ファイルを除去する
- 週間計画全テスト、build、diff checkを実行する
- deterministic baseline、action優先順位、clarification contextの主要回帰を確認する

## 完了条件

- [ ] PRのbaseが`main`である
- [ ] PRがmergeableである
- [ ] 一時workflow、script、trigger、検証artifactがPR差分にない
- [ ] `npm run test:run -- src/features/weeklyPlanning`が成功する
- [ ] `npm run build`が成功する
- [ ] `git diff --check`が成功する
- [ ] PR本文の変更内容と検証結果が最新である
- [ ] 親trackerをclosedへ更新できる

## 終了処理

完了後、このmdと親trackerの`Status`を`closed`へ変更する。PR自体のmergeまたはcloseは、最終差分の確認後に行う。
