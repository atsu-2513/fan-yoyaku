const express = require('express');
const {
  getValidToken,
  markTokenUsed,
  isSlotTaken,
  getTakenSlots,
  createReservation,
} = require('../db');
const { isBusinessDay, slotsForDate, isValidMenu, menuLabel, MENUS } = require('../businessHours');
const { pushText } = require('../line');

const router = express.Router();

// トークンが有効か確認（予約ページ読み込み時に使用）
router.get('/api/booking/token/:token', (req, res) => {
  const row = getValidToken(req.params.token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  res.json({ ok: true, menus: MENUS });
});

// 指定日の空き状況を返す
router.get('/api/booking/availability', (req, res) => {
  const { token, date } = req.query;
  const row = getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });

  const allSlots = slotsForDate(date);
  const taken = new Set(getTakenSlots(date));
  const available = allSlots.filter((t) => !taken.has(t));
  res.json({ ok: true, date, businessDay: isBusinessDay(date), slots: available });
});

// 予約作成
router.post('/api/booking', async (req, res) => {
  const { token, date, time, menu, name, phone } = req.body || {};

  const row = getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });

  if (!date || !time || !menu || !name || !phone) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  if (!isBusinessDay(date) || !slotsForDate(date).includes(time)) {
    return res.status(400).json({ ok: false, error: 'invalid_date_or_time' });
  }
  if (!isValidMenu(menu)) {
    return res.status(400).json({ ok: false, error: 'invalid_menu' });
  }
  const phonePattern = /^[0-9-]{9,14}$/;
  if (!phonePattern.test(phone)) {
    return res.status(400).json({ ok: false, error: 'invalid_phone' });
  }
  if (isSlotTaken(date, time)) {
    return res.status(409).json({ ok: false, error: 'slot_taken' });
  }

  const reservation = createReservation({
    lineUserId: row.line_user_id,
    date,
    time,
    menu,
    name: String(name).trim(),
    phone: String(phone).trim(),
  });
  markTokenUsed(token);

  try {
    await pushText(
      row.line_user_id,
      `${reservation.name}様\n仮予約を受け付けました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `メニュー: ${menuLabel(reservation.menu)}\n\n` +
        `店舗からの確定連絡をお待ちください。`
    );
  } catch (err) {
    console.error('LINE push (仮予約) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
