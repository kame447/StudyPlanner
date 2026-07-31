# アプリ起動直後の再マウントと表示揺れ修正

Status: implemented, verification pending
Date: 2026-08-01
Branch: `agent/fix-app-startup-remount`

## 症状

ログイン後にアプリ画面へ移行した直後、短時間で再読込されたように画面が切り替わり、予定データの反映時にも画面全体が揺れる。

## 原因

1. `StudyPlannerAppRoot`と`App`内部が同じFirebase認証を別々に復元していた。
2. ログイン成功時に内側の`App`が先に認証済み画面を表示した後、外側のauth listenerが`App`を破棄して同意・個別設定・再起動経路へ切り替えていた。
3. 再マウント後の`bootstrapSession`がPlannerデータ取得前に`booting=false`へ変更し、空に近い画面を一度表示していた。

## 修正

- 外側の認証境界が有効な未ログイン画面を`RootManagedAuthenticationProvider`で明示した。
- root-managed経路でログインした場合、内側のauth hookはローカル`user`を確定せず、外側のFirebase auth listenerへ画面遷移を委譲する。
- session復元時は認証ユーザー取得後も`booting`を維持し、Plannerデータ取得または取得失敗の処理完了後にだけ解除する。

## 回帰テスト

- Plannerデータ取得中は`booting`が解除されない。
- root-managedログインでは内側の認証済み画面を先行表示しない。
- root境界がない開発・fallback経路では従来のself-managedログインを維持する。
- `StudyPlannerAppRoot`の未ログイン経路がroot-managed providerを使用する。

## 検証

GitHub Actionsと利用者のローカル検証が完了するまでmerge済みとは扱わない。
