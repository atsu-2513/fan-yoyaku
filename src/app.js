require('dotenv').config();
const path = require('path');
const express = require('express');

const webhookRouter = require('./routes/webhook');
const bookingRouter = require('./routes/booking');
const adminRouter = require('./routes/admin');
const staffRouter = require('./routes/staff');
const cronRouter = require('./routes/cron');
const shopRouter = require('./routes/shop');

const app = express();

// LINEの署名検証のため、webhookは express.json() より前・生ボディのまま登録する
app.use(webhookRouter);

// 店販の商品写真をJSON内にBase64で含めてアップロードするため、上限を広めに取る
app.use(express.json({ limit: '8mb' }));

// 管理画面(オーナー用)はBasic認証で保護してから静的配信
app.use('/admin', adminRouter.auth, express.static(path.join(__dirname, '..', 'public', 'admin')));

app.use('/booking', express.static(path.join(__dirname, '..', 'public', 'booking')));

app.use('/shop', express.static(path.join(__dirname, '..', 'public', 'shop')));

// スタッフ画面は独自ログイン(Cookie)で保護するため、静的ファイル自体は公開し
// 各APIエンドポイント側で認証をチェックする(src/routes/staff.js)
app.use('/staff', express.static(path.join(__dirname, '..', 'public', 'staff')));

app.use(adminRouter);
app.use(bookingRouter);
app.use(staffRouter);
app.use(cronRouter);
app.use(shopRouter);

app.get('/', (req, res) => {
  res.type('text/plain').send('hair salon FAN 予約システム稼働中');
});

module.exports = app;
