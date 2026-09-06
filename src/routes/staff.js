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
} = require('../db');
const { isBusinessDay, SLOT_HOURS, menuLabel } = require('../businessHours');
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
  const candidateSlots = isBusinessDay(date) ? SLOT_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`) : [];
  const openSlots = await getOpenSlotsForStaff(req.staff.id, date);
  res.json({ ok: true, date, businessDay: isBusinessDay(date), candidateSlots, openSlots });
});

router.post('/staff/api/slots/toggle', requireStaffAuth, async (req, res) => {
  const { date, time } = req.body || {};
  if (!date || !time) return res.status(400).json({ ok: false, error: 'missing_fields' });
  if (!isBusinessDay(date)) return res.status(400).json({ ok: false, error: 'not_business_day' });

  const openSlots = await getOpenSlotsForStaff(req.staff.id, date);
  if (openSlots.includes(time)) {
    await closeSlot(req.staff.id, date, time);
    return res.json({ ok: true, open: false });
  }
  await openSlot(req.staff.id, date, time);
  res.json({ ok: true, open: true });
});

router.get('/staff/api/reservations', requireStaffAuth, async (req, res) => {
  const reservations = (await listReservationsForStaff(req.staff.id)).map((r) => ({
    ...r,
    menuLabel: menuLabel(r.menu),
  }));
  res.json({ ok: true, reservations });
});

router.post('/staff/api/reservations/:id/confirm', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getReservation(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (existing.status === 'confirmed') {
    return res.json({ ok: true, reservation: existing });
  }

  const reservation = await confirmReservation(id);

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\nご予約が確定しました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `担当: ${req.staff.name}\n` +
        `メニュー: ${menuLabel(reservation.menu)}\n\n` +
        `ご来店を心よりお待ちしております。`
    );
  } catch (err) {
    console.error('LINE push (確定/staff) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
module.exports.requireStaffAuth = requireStaffAuth;
