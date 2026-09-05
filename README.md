# hair salon FAN 予約システム

LINE Messaging APIと連携したシンプルな予約システムです。

## 予約の流れ

1. お客様がLINE公式アカウントに「予約」と送信
2. Botが予約フォームのURL（有効期限30分）を返信
3. お客様がURLを開き、カレンダーで日時 → メニュー（カット/カラー/パーマ）→ 氏名・電話番号を入力して送信
4. 送信と同時にLINEへ「仮予約を受け付けました」と通知
5. オーナーが管理画面（`/admin`）で予約一覧を確認
6. 「確定する」ボタンを押すとお客様に「予約が確定しました」とLINE通知

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. LINE Developersでの設定

1. [LINE Developers Console](https://developers.line.biz/) でMessaging APIチャネルを作成
2. チャネルアクセストークン（長期）とチャネルシークレットを取得
3. Webhook URLを `https://<公開URL>/webhook` に設定し、Webhookを有効化
4. 応答メッセージ・あいさつメッセージは任意でOFFにする（Bot側の自動応答と競合しないように）

### 3. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集:

```
LINE_CHANNEL_ACCESS_TOKEN=（チャネルアクセストークン）
LINE_CHANNEL_SECRET=（チャネルシークレット）
BASE_URL=https://<公開URL>          # 予約ページ・WebhookのベースURL
ADMIN_USER=owner                     # 管理画面ログインID
ADMIN_PASS=（強力なパスワードに変更）
PORT=3000
TURSO_DATABASE_URL=                  # 本番(Vercel)では必須。ローカルは未設定でOK
TURSO_AUTH_TOKEN=                    # 本番(Vercel)では必須。ローカルは未設定でOK
```

ローカルで動作確認する場合は `ngrok http 3000` などでトンネルを作り、その公開URLを
`BASE_URL` とLINEのWebhook URLの両方に設定してください。
DBはローカルでは `TURSO_DATABASE_URL` 未設定時に自動で `data/fan-yoyaku.db`（SQLite互換のファイルDB）が使われます。

### 4. 起動

```bash
npm start
```

- 予約ページ: `<BASE_URL>/booking/?token=...`（LINEからのリンク経由でのみ有効）
- 管理画面: `<BASE_URL>/admin/`（Basic認証で保護）

## 営業日・営業時間の変更

`src/businessHours.js` に定休日（デフォルト: 火曜）と受付時間（デフォルト: 10時〜18時、1時間単位）を
定義しています。実際の営業時間に合わせて編集してください。

## データ

予約データは [Turso](https://turso.tech/)（libSQL / SQLite互換のマネージドDB）に保存されます。
Vercelなどのサーバーレス環境はファイルシステムが永続化されないため、本番では
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` を必ず設定してください。ローカル開発では
これらを未設定にすると `data/fan-yoyaku.db` にファイルとして保存されます。

## Vercelへのデプロイ

1. [Turso](https://turso.tech/) でDBを作成し、DB URLと認証トークンを取得
   ```bash
   turso db create fan-yoyaku
   turso db show fan-yoyaku --url
   turso db tokens create fan-yoyaku
   ```
2. Vercelプロジェクトの環境変数に `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` /
   `BASE_URL`（VercelのURL）/ `ADMIN_USER` / `ADMIN_PASS` / `TURSO_DATABASE_URL` /
   `TURSO_AUTH_TOKEN` を設定
3. `vercel --prod` などでデプロイ（`api/index.js` がサーバーレス関数のエントリーポイント）
4. LINE DevelopersのWebhook URLを `https://<VercelのURL>/webhook` に更新

## 技術構成

- Node.js / Express（`api/index.js` からVercel Functionsとして実行）
- `@line/bot-sdk`（Messaging API連携・Webhook署名検証）
- `@libsql/client`（Turso / libSQL、予約・予約用トークンの保存）
- 予約ページ・管理画面はビルド不要のシンプルなHTML/CSS/JS
