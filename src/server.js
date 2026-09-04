require('dotenv').config();
const path = require('path');
const express = require('express');

const webhookRouter = require('./routes/webhook');
const bookingRouter = require('./routes/booking');
const adminRouter = require('./routes/admin');

const app = express();

// LINEの署名検証のため、webhookは express.json() より前・生ボディのまま登録する
app.use(webhookRouter);

app.use(express.json());

// 管理画面はBasic認証で保護してから静的配信
app.use('/admin', adminRouter.auth, express.static(path.join(__dirname, '..', 'public', 'admin')));

app.use('/booking', express.static(path.join(__dirname, '..', 'public', 'booking')));

app.use(adminRouter);
app.use(bookingRouter);

app.get('/', (req, res) => {
  res.type('text/plain').send('hair salon FAN 予約システム稼働中');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`fan-yoyaku server listening on port ${port}`);
});
