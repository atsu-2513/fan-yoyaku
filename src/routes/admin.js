const express = require('express');
const basicAuth = require('express-basic-auth');
const { listReservations, getReservation, confirmReservation } = require('../db');
const { menuLabel } = require('../businessHours');
const { pushText } = require('../line');

const router = express.Router();

const auth = basicAuth({
  users: { [process.env.ADMIN_USER || 'owner']: process.env.ADMIN_PASS || 'changeme' },
  challenge: true,
  realm: 'fan-yoyaku admin',
});

router.use('/api/admin', auth);

router.get('/api/admin/reservations', async (req, res) => {
  const reservations = (await listReservations()).map((r) => ({
    ...r,
    menuLabel: menuLabel(r.menu),
  }));
  res.json({ ok: true, reservations });
});

router.post('/api/admin/reservations/:id/confirm', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getReservation(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (existing.status === 'confirmed') {
    return res.json({ ok: true, reservation: existing });
  }

  const reservation = await confirmReservation(id);

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\nご予約が確定しました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `メニュー: ${menuLabel(reservation.menu)}\n\n` +
        `ご来店を心よりお待ちしております。`
    );
  } catch (err) {
    console.error('LINE push (確定) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
module.exports.auth = auth;
