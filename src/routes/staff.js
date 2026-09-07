const express = require('express');
const {
  getStaffByUsername,
  getStaffById,
  updateStaffPassword,
  openSlot,
  closeSlot,
  getOpenSlotsForStaff,
  listReservationsForStaff,
  getReservation,
  confirmReservation,
  cancelReservation,
  copyOpenSlotsToDates,
} = require('../db');
const { isBusinessDay, getSlotHours, menuLabel } = require('../businessHours');
const { hashPassword, verifyPassword, createSessionCookie, clearSessionCookie, getStaffIdFromRequest } = require('../auth');
const { pushText } = require('../line');

const router = express.Router();

// スタッフAPI専用の認証ミドルウェア(Cookieの署名付きセッション)
async function requireStaffAuth(req, res, next) {
  const staffId = getStaffIdFromRequest(req);
  if (!staffId) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const staff = await getStaffById(staffId);
  if (!staff || !staff.active) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.staff = staff;
  next();
}

router.post('/staff/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  const staff = await getStaffByUsername(String(username).trim());
  if (!staff || !staff.active || !verifyPassword(password, staff.password_hash)) {
    return res.status(401).json({ ok: false, error: 'invalid_credentials' });
  }
  res.setHeader('Set-Cookie', createSessionCookie(staff.id));
  res.json({ ok: true, staff: { id: staff.id, name: staff.name } });
});

router.post('/staff/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

router.get('/staff/api/me', requireStaffAuth, (req, res) => {
  res.json({ ok: true, staff: { id: req.staff.id, name: req.staff.name } });
});

router.post('/staff/api/change-password', requireStaffAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  if (!verifyPassword(oldPassword, req.staff.password_hash)) {
    return res.status(401).json({ ok: false, error: 'invalid_current_password' });
  }
  if (String(newPassword).length < 4) {
    return res.status(400).json({ ok: false, error: 'password_too_short' });
  }
  await updateStaffPassword(req.staff.id, hashPassword(newPassword));
  res.json({ ok: true });
});

// その日に開放できる候補時間(定休日なら空)と、自分がすでに開放済みの時間を返す
router.get('/staff/api/slots', requireStaffAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });
  const businessDay = await isBusinessDay(date);
  const candidateSlots = businessDay ? (await getSlotHours()).map((h) => `${String(h).padStart(2, '0')}:00`) : [];
  const openSlots = await getOpenSlotsForStaff(req.staff.id, date);
  res.json({ ok: true, date, businessDay, candidateSlots, openSlots });
});

router.post('/staff/api/slots/toggle', requireStaffAuth, async (req, res) => {
  const { date, time } = req.body || {};
  if (!date || !time) return res.status(400).json({ ok: false, error: 'missing_fields' });
  if (!(await isBusinessDay(date))) return res.status(400).json({ ok: false, error: 'not_business_day' });

  const openSlots = await getOpenSlotsForStaff(req.staff.id, date);
  if (openSlots.includes(time)) {
    await closeSlot(req.staff.id, date, time);
    return res.json({ ok: true, open: false });
  }
  await openSlot(req.staff.id, date, time);
  res.json({ ok: true, open: true });
});

// sourceDateに自分が開放している時間を、選んだ複数のtargetDatesにまとめてコピーする
router.post('/staff/api/slots/copy', requireStaffAuth, async (req, res) => {
  const { sourceDate, targetDates } = req.body || {};
  if (!sourceDate || !Array.isArray(targetDates) || targetDates.length === 0) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  const validTargets = [];
  for (const d of targetDates) {
    if (typeof d === 'string' && (await isBusinessDay(d))) validTargets.push(d);
  }
  const skipped = targetDates.length - validTargets.length;
  const { copied } = await copyOpenSlotsToDates(req.staff.id, sourceDate, validTargets);
  res.json({ ok: true, copied, skipped });
});

router.get('/staff/api/reservations', requireStaffAuth, async (req, res) => {
  const rows = await listReservationsForStaff(req.staff.id);
  const reservations = [];
  for (const r of rows) {
    reservations.push({ ...r, menuLabel: await menuLabel(r.menu) });
  }
  res.json({ ok: true, reservations });
});

router.post('/staff/api/reservations/:id/confirm', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { reply } = req.body || {};
  const existing = await getReservation(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (existing.status === 'confirmed') {
    return res.json({ ok: true, reservation: existing });
  }

  const replyText = typeof reply === 'string' ? reply.trim().slice(0, 1000) : '';
  const reservation = await confirmReservation(id, replyText || null);

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\nご予約が確定しました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `担当: ${req.staff.name}\n` +
        `メニュー: ${await menuLabel(reservation.menu)}\n\n` +
        `ご来店を心よりお待ちしております。` +
        (reservation.reply_message ? `\n\n【ご相談へのご返信】\n${reservation.reply_message}` : '')
    );
  } catch (err) {
    console.error('LINE push (確定/staff) failed:', err);
  }

  res.json({ ok: true, reservation });
});

router.post('/staff/api/reservations/:id/cancel', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getReservation(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (existing.status === 'cancelled') {
    return res.json({ ok: true, reservation: existing });
  }

  const reservation = await cancelReservation(id);

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\n誠に申し訳ございませんが、以下のご予約はキャンセルとなりました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `担当: ${req.staff.name}\n` +
        `メニュー: ${await menuLabel(reservation.menu)}\n\n` +
        `ご不明な点がございましたら店舗までご連絡ください。`
    );
  } catch (err) {
    console.error('LINE push (キャンセル/staff) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
module.exports.requireStaffAuth = requireStaffAuth;
