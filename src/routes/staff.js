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
  upsertCustomer,
  listCustomersForStaff,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerHistory,
  listMenusForStaff,
  getCandidateRequest,
  listCandidateRequestsForStaff,
  confirmCandidateRequest,
  declineCandidateRequest,
  getWaitlistAlert,
  listOpenWaitlistAlertsForStaff,
  markWaitlistAlertStatus,
  updateReservationDateTime,
} = require('../db');
const { isBusinessDay, slotsForDate, getSlotTimes, menuLabel } = require('../businessHours');
const { computeAvailableStartTimes, expandRange } = require('../availability');
const { hashPassword, verifyPassword, createSessionCookie, clearSessionCookie, getStaffIdFromRequest } = require('../auth');
const { pushText } = require('../line');
const { checkAndCreateWaitlistAlerts } = require('../waitlist');

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
  const candidateSlots = businessDay ? await getSlotTimes() : [];
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

// 予約の日時変更(reschedule)パネル用: 指定日の、この予約自身の枠は空きとして扱った空き時間一覧
router.get('/staff/api/availability', requireStaffAuth, async (req, res) => {
  const { date, reservationId } = req.query;
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });
  if (!(await isBusinessDay(date))) {
    return res.json({ ok: true, date, businessDay: false, slots: [] });
  }
  let durationMinutes = 60;
  let existing = null;
  if (reservationId) {
    const candidate = await getReservation(Number(reservationId));
    if (candidate && Number(candidate.staff_id) === Number(req.staff.id)) {
      existing = candidate;
      const staffMenus = await listMenusForStaff(req.staff.id);
      const selectedMenu = staffMenus.find((m) => m.id === existing.menu);
      durationMinutes = (selectedMenu && selectedMenu.durationMinutes) || existing.duration_minutes || 60;
    }
  }
  const candidateSlots = await slotsForDate(date);
  const openSlots = await getOpenSlotsForStaff(req.staff.id, date);
  const takenSlotsRaw = await getTakenSlots(req.staff.id, date);
  const ownSlots = new Set(existing && existing.date === date ? expandRange(existing.time, durationMinutes) : []);
  const takenSlots = takenSlotsRaw.filter((t) => !ownSlots.has(t));
  const available = computeAvailableStartTimes({ candidateSlots, openSlots, takenSlots, durationMinutes });
  res.json({ ok: true, date, businessDay: true, slots: available });
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

  try {
    await checkAndCreateWaitlistAlerts(reservation);
  } catch (err) {
    console.error('空き通知チェックに失敗しました:', err);
  }

  res.json({ ok: true, reservation });
});

// ---------- 顧客管理(スタッフごとの簡易リスト) ----------
router.get('/staff/api/customers', requireStaffAuth, async (req, res) => {
  const customers = await listCustomersForStaff(req.staff.id);
  res.json({ ok: true, customers });
});

// 電話予約・walk-inのお客様などを手動で追加する(すでに同じ電話番号があれば名前だけ更新)
router.post('/staff/api/customers', requireStaffAuth, async (req, res) => {
  const { name, phone } = req.body || {};
  const nameTrimmed = typeof name === 'string' ? name.trim().slice(0, 100) : '';
  const phoneTrimmed = typeof phone === 'string' ? phone.trim().slice(0, 20) : '';
  if (!nameTrimmed || !phoneTrimmed) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  await upsertCustomer(req.staff.id, nameTrimmed, phoneTrimmed);
  const customers = await listCustomersForStaff(req.staff.id);
  res.json({ ok: true, customers });
});

router.put('/staff/api/customers/:id', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCustomerById(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const { name, memo } = req.body || {};
  const nameTrimmed = typeof name === 'string' ? name.trim().slice(0, 100) : existing.name;
  const memoTrimmed = typeof memo === 'string' ? memo.trim().slice(0, 1000) : existing.memo;
  if (!nameTrimmed) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  const customer = await updateCustomer(id, { name: nameTrimmed, memo: memoTrimmed });
  res.json({ ok: true, customer });
});

router.delete('/staff/api/customers/:id', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCustomerById(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  await deleteCustomer(id);
  res.json({ ok: true });
});

router.get('/staff/api/customers/:id/history', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCustomerById(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const rows = await getCustomerHistory(existing.staff_id, existing.phone);
  const history = [];
  for (const r of rows) history.push({ ...r, menuLabel: await menuLabel(r.menu) });
  res.json({ ok: true, history });
});


// ---------- 候補日リクエスト(自分宛のみ) ----------
router.get('/staff/api/candidate-requests', requireStaffAuth, async (req, res) => {
  const requests = await listCandidateRequestsForStaff(req.staff.id);
  res.json({ ok: true, requests });
});

router.post('/staff/api/candidate-requests/:id/confirm', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const rank = Number(req.body?.rank);
  const existing = await getCandidateRequest(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (existing.status !== 'pending') {
    return res.status(409).json({ ok: false, error: 'already_handled' });
  }
  const chosen = existing.dates.find((d) => Number(d.rank) === rank);
  if (!chosen) return res.status(400).json({ ok: false, error: 'invalid_rank' });

  const staffMenus = await listMenusForStaff(req.staff.id);
  const selectedMenu = staffMenus.find((m) => m.id === existing.menu);
  const durationMinutes = (selectedMenu && selectedMenu.durationMinutes) || existing.duration_minutes || 60;
  const candidateSlots = await slotsForDate(chosen.date);
  const openSlots = await getOpenSlotsForStaff(req.staff.id, chosen.date);
  const takenSlots = await getTakenSlots(req.staff.id, chosen.date);
  const available = computeAvailableStartTimes({ candidateSlots, openSlots, takenSlots, durationMinutes });
  if (!available.includes(chosen.time)) {
    return res.status(409).json({ ok: false, error: 'slot_taken' });
  }

  const confirmed = await confirmCandidateRequest(id, rank);
  const reservation = confirmed.reservation;

  try {
    await pushText(
      reservation.line_user_id,
      reservation.name + '様\nご予約が確定しました。\n\n' +
        '日時: ' + reservation.date + ' ' + reservation.time + '\n' +
        '担当: ' + req.staff.name + '\n' +
        'メニュー: ' + (await menuLabel(reservation.menu)) + '\n\n' +
        'ご来店を心よりお待ちしております。'
    );
  } catch (err) {
    console.error('LINE push (候補日確定/staff) failed:', err);
  }

  res.json({ ok: true, request: confirmed.request, reservation });
});

router.post('/staff/api/candidate-requests/:id/decline', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCandidateRequest(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (existing.status !== 'pending') {
    return res.json({ ok: true, request: existing });
  }
  const request = await declineCandidateRequest(id);

  try {
    await pushText(
      existing.line_user_id,
      existing.name + '様\n誠に申し訳ございませんが、ご提示いただいた候補日はいずれも埋まっております。\n\n' +
        'お手数ですが、再度ご希望日時をご相談させてください。'
    );
  } catch (err) {
    console.error('LINE push (候補日見送り/staff) failed:', err);
  }

  res.json({ ok: true, request });
});

// ---------- 空き通知(自分宛のみ) ----------
router.get('/staff/api/waitlist-alerts', requireStaffAuth, async (req, res) => {
  const alerts = await listOpenWaitlistAlertsForStaff(req.staff.id);
  res.json({ ok: true, alerts });
});

router.post('/staff/api/waitlist-alerts/:id/notify', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const alert = await getWaitlistAlert(id);
  if (!alert || Number(alert.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const customMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const message = customMessage
    ? customMessage.slice(0, 1000)
    : alert.name + '様\nご希望されていた ' + alert.date + ' ' + alert.time + ' に空きが出ました。\n' +
      'ご都合がよろしければ、このメッセージにご返信いただくか、店舗までご連絡ください。';

  try {
    await pushText(alert.line_user_id, message);
  } catch (err) {
    console.error('LINE push (空き通知/staff) failed:', err);
    return res.status(502).json({ ok: false, error: 'line_push_failed' });
  }

  const updated = await markWaitlistAlertStatus(id, 'contacted');
  res.json({ ok: true, alert: updated });
});

router.post('/staff/api/waitlist-alerts/:id/dismiss', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const alert = await getWaitlistAlert(id);
  if (!alert || Number(alert.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const updated = await markWaitlistAlertStatus(id, 'dismissed');
  res.json({ ok: true, alert: updated });
});

// ---------- 予約日時の変更(画面上でそのまま変更する) ----------
router.post('/staff/api/reservations/:id/reschedule', requireStaffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { date, time } = req.body || {};
  if (!date || !time) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const existing = await getReservation(id);
  if (!existing || Number(existing.staff_id) !== Number(req.staff.id)) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (existing.status === 'cancelled') {
    return res.status(409).json({ ok: false, error: 'already_cancelled' });
  }
  if (!(await isBusinessDay(date))) {
    return res.status(400).json({ ok: false, error: 'invalid_date_or_time' });
  }
  const staffMenus = await listMenusForStaff(req.staff.id);
  const selectedMenu = staffMenus.find((m) => m.id === existing.menu);
  const durationMinutes = (selectedMenu && selectedMenu.durationMinutes) || existing.duration_minutes || 60;
  const candidateSlots = await slotsForDate(date);
  const openSlots = await getOpenSlotsForStaff(req.staff.id, date);
  const takenSlotsRaw = await getTakenSlots(req.staff.id, date);
  const ownSlots = new Set(existing.date === date ? expandRange(existing.time, durationMinutes) : []);
  const takenSlots = takenSlotsRaw.filter((t) => !ownSlots.has(t));
  const available = computeAvailableStartTimes({ candidateSlots, openSlots, takenSlots, durationMinutes });
  if (!available.includes(time)) {
    return res.status(409).json({ ok: false, error: 'slot_taken' });
  }

  const reservation = await updateReservationDateTime(id, { date, time });

  try {
    await pushText(
      reservation.line_user_id,
      reservation.name + '様\nご予約の日時を変更いたしました。\n\n' +
        '変更後: ' + reservation.date + ' ' + reservation.time + '\n' +
        '担当: ' + req.staff.name + '\n' +
        'メニュー: ' + (await menuLabel(reservation.menu)) + '\n\n' +
        'ご不明な点がございましたら店舗までご連絡ください。'
    );
  } catch (err) {
    console.error('LINE push (日時変更/staff) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
module.exports.requireStaffAuth = requireStaffAuth;
