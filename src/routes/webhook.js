const express = require('express');
const line = require('@line/bot-sdk');
const { config, client } = require('../line');
const {
  createBookingToken,
  createShopToken,
  listUpcomingReservationsForUser,
  getReservation,
  cancelReservation,
  getStaffById,
  setPendingChangeRequest,
  getPendingChangeRequest,
  clearPendingChangeRequest,
  recordChangeRequest,
} = require('../db');
const { menuLabel, todayJST } = require('../businessHours');
const { sendMail } = require('../mail');

const router = express.Router();

// Instagramアカウントの固定URL(「Instagram」「インスタ」と送信されたときの案内用)
const INSTAGRAM_URL = 'https://www.instagram.com/hairsalon_fan/?hl=ja';

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

    await clearPendingChangeRequest(userId);

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

  if (text === '変更') {
    await handleChangeRequestStart(event, userId);
    return;
  }

  if (text === '店販') {
    if (!userId) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: 'ご案内できませんでした。時間をおいて再度お試しください。' }],
      });
      return;
    }

    await clearPendingChangeRequest(userId);

    const token = await createShopToken(userId);
    const url = `${process.env.BASE_URL}/shop/?token=${token}`;

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text: `店販商品はこちらからどうぞ🛍\n${url}\n\n※このURLは30分間有効です。`,
        },
      ],
    });
    return;
  }

  if (text.toLowerCase() === 'instagram' || text === 'インスタ') {
    if (userId) await clearPendingChangeRequest(userId);

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text: `Instagramはこちらです📷\n${INSTAGRAM_URL}`,
        },
      ],
    });
    return;
  }

  // 直前に「変更」→対象のご予約を選んでいた場合、このメッセージをその変更希望として扱う
  if (userId) {
    const pending = await getPendingChangeRequest(userId);
    if (pending) {
      await handleChangeRequestMessage(event, userId, pending, text);
      return;
    }
  }

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'text',
        text: 'ご予約は「予約」、ご予約のキャンセルは「キャンセル」、ご予約の変更のご希望は「変更」、店販商品のご案内は「店販」、Instagramのご案内は「Instagram」と送信してください。',
      },
    ],
  });
}

// 「キャンセル」受信時: そのお客様の今日以降の予約を一覧にして選んでもらう
async function handleCancelRequest(event, userId) {
  if (!userId) return;

  await clearPendingChangeRequest(userId);

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

// 「変更」受信時: そのお客様の今日以降の予約を一覧にして選んでもらう
async function handleChangeRequestStart(event, userId) {
  if (!userId) return;

  const reservations = await listUpcomingReservationsForUser(userId, todayJST());
  if (reservations.length === 0) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '現在、変更をご希望いただけるご予約がありません。' }],
    });
    return;
  }

  const items = reservations.slice(0, 13).map((r) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `${r.date} ${r.time}`,
      data: `changerequest:${r.id}`,
      displayText: `${r.date} ${r.time} のご予約の変更を希望`,
    },
  }));

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'text',
        text: '変更をご希望のご予約を選んでください。',
        quickReply: { items },
      },
    ],
  });
}

// postbackイベントの振り分け(キャンセル対象の選択 / 変更希望対象の選択)
async function handlePostback(event) {
  const data = event.postback && event.postback.data;
  if (!data) return;
  if (data.startsWith('changerequest:')) {
    return handleChangeRequestSelected(event, data);
  }
  if (!data.startsWith('cancel:')) return;

  const id = Number(data.slice('cancel:'.length));
  const userId = event.source.userId;

  if (userId) await clearPendingChangeRequest(userId);

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
          `メニュー: ${await menuLabel(cancelled.menu)}\n\n` +
          `またのご利用をお待ちしております。`,
      },
    ],
  });
}

// 変更したいご予約が選ばれたとき(postbackイベント): 次のメッセージを変更希望として待ち受ける
async function handleChangeRequestSelected(event, data) {
  const id = Number(data.slice('changerequest:'.length));
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

  await setPendingChangeRequest(userId, id);

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'text',
        text:
          `${reservation.date} ${reservation.time} のご予約ですね。\n` +
          `ご希望の変更内容（ご希望の日時やご要望など）を、メッセージで送ってください。`,
      },
    ],
  });
}

// 「変更」→ご予約選択のあとに届いたテキストメッセージを、変更希望として担当スタッフに伝える
async function handleChangeRequestMessage(event, userId, pending, text) {
  await clearPendingChangeRequest(userId);

  const reservation = await getReservation(pending.reservation_id);
  if (!reservation || reservation.line_user_id !== userId || reservation.status === 'cancelled') {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'ご希望のご予約が見つかりませんでした。お手数ですが「変更」から選び直してください。' }],
    });
    return;
  }

  const message = text.slice(0, 500);
  const updated = await recordChangeRequest(reservation.id, message);
  const staff = updated.staff_id ? await getStaffById(updated.staff_id) : null;

  try {
    const recipients = [staff && staff.email, process.env.OWNER_EMAIL].filter(Boolean);
    if (recipients.length) {
      await sendMail({
        to: recipients,
        subject: `【予約変更のご希望】${updated.date} ${updated.time} ${staff ? staff.name + '様指名' : ''}`,
        text:
          `ご予約の変更をご希望のメッセージが届きました。\n\n` +
          `現在のご予約日時: ${updated.date} ${updated.time}\n` +
          (staff ? `担当: ${staff.name}\n` : '') +
          `メニュー: ${await menuLabel(updated.menu)}\n` +
          `お名前: ${updated.name}\n` +
          `電話番号: ${updated.phone}\n\n` +
          `ご希望の内容:\n${message}\n` +
          (process.env.BASE_URL ? `\n管理画面で確認: ${process.env.BASE_URL}/admin/` : ''),
      });
    }
  } catch (err) {
    console.error('メール通知(予約変更希望)の送信に失敗しました:', err);
  }

  await client.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'text',
        text: '変更のご希望を担当スタッフにお伝えしました。確認でき次第、担当からご連絡いたします。',
      },
    ],
  });
}

module.exports = router;
