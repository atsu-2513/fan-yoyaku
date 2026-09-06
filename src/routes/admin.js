const express = require('express');
const basicAuth = require('express-basic-auth');
const {
  listReservationsWithStaff,
  getReservation,
  confirmReservation,
  cancelReservation,
  listAllStaff,
  getStaffById,
  getOpenSlotsForStaff,
  getTakenSlots,
} = require('../db');
const { menuLabel, isBusinessDay, SLOT_HOURS } = require('../businessHours');
const { pushText } = require('../line');

const router = express.Router();

const auth = basicAuth({
  users: { [process.env.ADMIN_USER || 'owner']: process.env.ADMIN_PASS || 'changeme' },
  challenge: true,
  realm: 'fan-yoyaku admin',
});

router.use('/api/admin', auth);

router.get('/api/admin/reservations', async (req, res) => {
  const reservations = (await listReservationsWithStaff()).map((r) => ({
    ...r,
    menuLabel: menuLabel(r.menu),
  }));
  res.json({ ok: true, reservations });
});

router.get('/api/admin/staff', async (req, res) => {
  res.json({ ok: true, staff: await listAllStaff() });
});

// オーナーが特定スタッフの、特定日の開放状況(未開放/受付中/予約済み)を確認するための一覧
router.get('/api/admin/staff/:id/slots', async (req, res) => {
  const staffId = Number(req.params.id);
  const { date } = req.query;
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });

  const staff = await getStaffById(staffId);
  if (!staff) return res.status(404).json({ ok: false, error: 'not_found' });

  const businessDay = isBusinessDay(date);
  const candidateSlots = businessDay ? SLOT_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`) : [];
  const openSlots = await getOpenSlotsForStaff(staffId, date);
  const takenSlots = await getTakenSlots(staffId, date);

  res.json({ ok: true, date, businessDay, candidateSlots, openSlots, takenSlots, staffName: staff.name });
});

router.post('/api/admin/reservations/:id/confirm', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getReservation(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (existing.status === 'confirmed') {
    return res.json({ ok: true, reservation: existing });
  }

  const reservation = await confirmReservation(id);
  const staff = reservation.staff_id ? await getStaffById(reservation.staff_id) : null;

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\nご予約が確定しました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        (staff ? `担当: ${staff.name}\n` : '') +
        `メニュー: ${menuLabel(reservation.menu)}\n\n` +
        `ご来店を心よりお待ちしております。`
    );
  } catch (err) {
    console.error('LINE push (確定) failed:', err);
  }

  res.json({ ok: true, reservation });
});

router.post('/api/admin/reservations/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getReservation(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (existing.status === 'cancelled') {
    return res.json({ ok: true, reservation: existing });
  }

  const reservation = await cancelReservation(id);

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\n誠に申し訳ございませんが、以下のご予約はキャンセルとなりました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `メニュー: ${menuLabel(reservation.menu)}\n\n` +
        `ご不明な点がございましたら店舗までご連絡ください。`
    );
  } catch (err) {
    console.error('LINE push (キャンセル/admin) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
module.exports.auth = auth;
