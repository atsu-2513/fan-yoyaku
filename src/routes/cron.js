const express = require('express');
const { listConfirmedReservationsForDate, markReminderSent, getStaffById } = require('../db');
const { menuLabel, tomorrowJST } = require('../businessHours');
const { pushText } = require('../line');

const router = express.Router();

// 外部の無料スケジューラ(cron-job.org等)から1日1回叩いてもらうエンドポイント。
// ?key=CRON_SECRET が一致しないと動かない(いたずら防止)。
// 明日の確定済み予約に、まだ送っていなければリマインドをLINEで送る。
router.get('/api/cron/send-reminders', async (req, res) => {
  const key = req.query.key;
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const date = tomorrowJST();
  const reservations = await listConfirmedReservationsForDate(date);

  let sent = 0;
  for (const r of reservations) {
    try {
      const staff = r.staff_id ? await getStaffById(r.staff_id) : null;
      await pushText(
        r.line_user_id,
        `${r.name}様\n明日のご予約のお知らせです。\n\n` +
          `日時: ${r.date} ${r.time}\n` +
          (staff ? `担当: ${staff.name}\n` : '') +
          `メニュー: ${menuLabel(r.menu)}\n\n` +
          `ご来店を心よりお待ちしております。`
      );
      await markReminderSent(r.id);
      sent += 1;
    } catch (err) {
      console.error('reminder push failed for reservation', r.id, err);
    }
  }

  res.json({ ok: true, date, count: reservations.length, sent });
});

module.exports = router;
