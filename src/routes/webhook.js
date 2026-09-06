const express = require('express');
const line = require('@line/bot-sdk');
const { config, client } = require('../line');
const {
  createBookingToken,
  listUpcomingReservationsForUser,
  getReservation,
  cancelReservation,
  getStaffById,
} = require('../db');
const { menuLabel, todayJST } = require('../businessHours');

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
  if (event.type === 'postback') {
    return handlePostback(event);
  }

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

    const token = await createBookingToken(userId);
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

  if (text === 'キャンセル') {
    await handleCancelRequest(event, userId);
    return;
  }

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      { type: 'text', text: 'ご予約は「予約」、ご予約のキャンセルは「キャンセル」と送信してください。' },
    ],
  });
}

// 「キャンセル」受信時: そのお客様の今日以降の予約を一覧にして選んでもらう
async function handleCancelRequest(event, userId) {
  if (!userId) return;

  const reservations = await listUpcomingReservationsForUser(userId, todayJST());
  if (reservations.length === 0) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '現在キャンセル可能なご予約はありません。' }],
    });
    return;
  }

  const items = reservations.slice(0, 13).map((r) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `${r.date} ${r.time}`,
      data: `cancel:${r.id}`,
      displayText: `${r.date} ${r.time} のご予約をキャンセル`,
    },
  }));

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'text',
        text: 'キャンセルしたいご予約を選んでください。',
        quickReply: { items },
      },
    ],
  });
}

// キャンセル対象の予約が選ばれたとき(postbackイベント)
async function handlePostback(event) {
  const data = event.postback && event.postback.data;
  if (!data || !data.startsWith('cancel:')) return;

  const id = Number(data.slice('cancel:'.length));
  const userId = event.source.userId;

  const reservation = await getReservation(id);
  if (!reservation || reservation.line_user_id !== userId) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'ご予約が見つかりませんでした。' }],
    });
    return;
  }
  if (reservation.status === 'cancelled') {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'このご予約はすでにキャンセルされています。' }],
    });
    return;
  }

  const cancelled = await cancelReservation(id);
  const staff = cancelled.staff_id ? await getStaffById(cancelled.staff_id) : null;

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'text',
        text:
          `ご予約をキャンセルしました。\n\n` +
          `日時: ${cancelled.date} ${cancelled.time}\n` +
          (staff ? `担当: ${staff.name}\n` : '') +
          `メニュー: ${menuLabel(cancelled.menu)}\n\n` +
          `またのご利用をお待ちしております。`,
      },
    ],
  });
}

module.exports = router;
