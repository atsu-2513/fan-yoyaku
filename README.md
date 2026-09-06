# hair salon FAN 予約システム

LINE Messaging APIと連携した、指名制（スタッフごとの空き時間管理）の予約システムです。

## 予約の流れ（お客様）

1. お客様がLINE公式アカウントに「予約」と送信
2. Botが予約フォームのURL（有効期限30分）を返信
3. お客様がURLを開き、①担当スタッフを指名 → ②カレンダーでそのスタッフの空き日時 → ③メニュー（カット/カラー/パーマ）→ ④氏名・電話番号を入力して送信
4. 送信と同時にLINEへ「仮予約を受け付けました」と通知
5. 担当スタッフ（またはオーナー）が管理画面で予約一覧を確認し「確定する」を押すと、お客様に「予約が確定しました」とLINE通知

## スタッフの空き時間管理

スタッフごとに `/staff/login.html` からログインし、自分の空き時間を自分で「開放」します。
お客様の予約フォームには、指名したスタッフが開放した時間だけが表示されます
（オーナー側で一律の営業時間を設定する方式ではなく、各スタッフが個別に予約を受け付けたい時間だけを開放する方式です）。

- スタッフ用ログイン画面: `<BASE_URL>/staff/login.html`
- スタッフ用ダッシュボード: `<BASE_URL>/staff/`（空き時間の設定・自分の予約一覧・パスワード変更）

定休日（デフォルト: 火曜）と、開放できる候補時間の枠（デフォルト: 10時〜18時、1時間単位）は
`src/businessHours.js` に定義しています。実際の営業時間に合わせて編集してください
（スタッフはこの候補時間の中からしか開放できません）。

### スタッフアカウントの作成

初回セットアップ時、以下のコマンドでスタッフアカウントを作成します。

```bash
npm run create-staff
```

`scripts/create-staff.js` 内の `STAFF` 配列を編集すれば、人数や名前・IDを変更できます。
実行すると初期パスワードがターミナルに表示されるので、各スタッフに伝えてください。
スタッフは初回ログイン後、ダッシュボード内の「パスワード変更」から自分で変更できます。
（同じユーザー名がすでに存在する場合はスキップされるので、何度実行しても安全です）

## オーナー用の管理画面

- `<BASE_URL>/admin/`（Basic認証で保護）
- 全スタッフの予約を一覧表示し、どのスタッフの予約でも確定操作ができます。

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. LINE Developersでの設定

1. [LINE Developers Console](https://developers.line.biz/) でMessaging APIチャネルを作成
2. チャネルアクセストークン（長期）とチャネルシークレットを取得
3. Webhook URLを `https://<公開URL>/webhook` に設定し、Webhookを有効化
4. **応答メッセージ・あいさつメッセージは必ずOFFにする**（[LINE Official Account Manager](https://manager.line.biz/) の「応答設定」から。ONのままだと、Bot側の予約案内メッセージと一緒にLINE標準の自動応答文が二重に届いてしまいます）

### 3. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して、`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `BASE_URL` /
`ADMIN_USER` / `ADMIN_PASS` / `SESSION_SECRET`（ランダムな文字列に変更）を設定してください。

ローカルで動作確認する場合は `ngrok http 3000` などでトンネルを作り、その公開URLを
`BASE_URL` とLINEのWebhook URLの両方に設定してください。
DBはローカルでは `TURSO_DATABASE_URL` 未設定時に自動で `data/fan-yoyaku.db`（SQLite互換のファイルDB）が使われます。

### 4. スタッフアカウントの作成

```bash
npm run create-staff
```

### 5. 起動

```bash
npm start
```

- 予約ページ: `<BASE_URL>/booking/?token=...`（LINEからのリンク経由でのみ有効）
- 管理画面(オーナー用): `<BASE_URL>/admin/`
- スタッフ用ログイン: `<BASE_URL>/staff/login.html`

## データ

予約データは [Turso](https://turso.tech/)（libSQL / SQLite互換のマネージドDB）に保存されます。
Render/Vercelなどファイルシステムが永続化されない環境では、本番で必ず
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` を設定してください。ローカル開発では
これらを未設定にすると `data/fan-yoyaku.db` にファイルとして保存されます。

起動時に、既存の `reservations` テーブルへ `staff_id` 列を自動追加するマイグレーションが
走ります（すでに列がある場合は何もしません）。

## デプロイ（Render / Vercel共通の注意点）

`src/server.js` の `app.listen()` を検出させ、Node.jsサーバーとしてそのまま起動させてください。
（Vercel FunctionsのようなヘルパーでラップするとLINEのWebhook署名検証に必要な生のリクエストボディが
消費されてしまい、`SignatureValidationFailed` で失敗します。）

デプロイ後、LINE DevelopersのWebhook URLを `https://<デプロイ先のURL>/webhook` に更新してください。

## 技術構成

- Node.js / Express（生のリクエストボディをLINEの署名検証に渡せるよう、ヘルパー付きの
  サーバーレスFunctionsは使わない構成）
- `@line/bot-sdk`（Messaging API連携・Webhook署名検証）
- `@libsql/client`（Turso / libSQL、予約・予約用トークン・スタッフ・空き時間の保存）
- スタッフ用ログインは追加パッケージなし（Node標準の `crypto` によるパスワードハッシュ化と
  署名付きセッションCookie）で実装
- 予約ページ・管理画面・スタッフ画面はビルド不要のシンプルなHTML/CSS/JS
