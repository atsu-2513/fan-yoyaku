const express = require('express');
const line = require('@line/bot-sdk');
const { config, client } = require('../line');
const { createBookingToken } = require('../db');

const router = express.Router();

router.post('/webhook', line.middleware(config), async (req, res) => {
  // LINEプラットフォームには即座に200を返す
  res.sendStatus(200);

  const events = req.body.events || [];
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('webhook event handling error:', err);
    }
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const text = event.message.text.trim();
  const userId = event.source.userId;

  if (text === '予約') {
    if (!userId) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '予約を受け付けられませんでした。時間をおいて再度お試しください。' }],
      });
      return;
    }

    const token = createBookingToken(userId);
    const url = `${process.env.BASE_URL}/booking/?token=${token}`;

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text: `ご予約はこちらからどうぞ✂️\n${url}\n\n※このURLは30分間有効です。`,
        },
      ],
    });
    return;
  }

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: 'ご予約は「予約」と送信してください。' }],
  });
}

module.exports = router;
