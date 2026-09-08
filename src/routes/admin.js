const express = require('express');
const basicAuth = require('express-basic-auth');
const {
  listReservationsWithStaff,
  getReservation,
  confirmReservation,
  cancelReservation,
  listAllStaff,
  getStaffById,
  updateStaffEmail,
  getOpenSlotsForStaff,
  getTakenSlots,
  getSettings,
  updateSettings,
  listAllMenusAdmin,
  createMenu,
  updateMenu,
  getStaffMenuOverrides,
  setStaffMenuOverride,
  listAllCustomersWithStaff,
  getCustomerById,
  getCustomerHistory,
  listQuizQuestionsWithOptions,
  createQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  createQuizOption,
  updateQuizOption,
  deleteQuizOption,
} = require('../db');
const {
  menuLabel,
  isBusinessDay,
  getSlotTimes,
  invalidateSettingsCache,
  invalidateMenuCache,
} = require('../businessHours');
const { pushText } = require('../line');

const router = express.Router();

const auth = basicAuth({
  users: { [process.env.ADMIN_USER || 'owner']: process.env.ADMIN_PASS || 'changeme' },
  challenge: true,
  realm: 'fan-yoyaku admin',
});

router.use('/api/admin', auth);

router.get('/api/admin/reservations', async (req, res) => {
  const rows = await listReservationsWithStaff();
  const reservations = [];
  for (const r of rows) {
    reservations.push({ ...r, menuLabel: await menuLabel(r.menu) });
  }
  res.json({ ok: true, reservations });
});

router.get('/api/admin/staff', async (req, res) => {
  res.json({ ok: true, staff: await listAllStaff() });
});

// 全スタッフぶんの顧客一覧(閲覧のみ。編集・削除はスタッフ本人の画面から)
router.get('/api/admin/customers', async (req, res) => {
  const customers = await listAllCustomersWithStaff();
  res.json({ ok: true, customers });
});

router.get('/api/admin/customers/:id/history', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCustomerById(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  const rows = await getCustomerHistory(existing.staff_id, existing.phone);
  const history = [];
  for (const r of rows) history.push({ ...r, menuLabel: await menuLabel(r.menu) });
  res.json({ ok: true, history });
});

// スタッフの通知先メールアドレスを設定(オーナーがまとめて管理する)
router.post('/api/admin/staff/:id/email', async (req, res) => {
  const staffId = Number(req.params.id);
  const { email } = req.body || {};
  const staff = await getStaffById(staffId);
  if (!staff) return res.status(404).json({ ok: false, error: 'not_found' });
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  const updated = await updateStaffEmail(staffId, trimmed || null);
  res.json({ ok: true, staff: updated });
});

// オーナーが特定スタッフの、特定日の開放状況(未開放/受付中/予約済み)を確認するための一覧
router.get('/api/admin/staff/:id/slots', async (req, res) => {
  const staffId = Number(req.params.id);
  const { date } = req.query;
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });

  const staff = await getStaffById(staffId);
  if (!staff) return res.status(404).json({ ok: false, error: 'not_found' });

  const businessDay = await isBusinessDay(date);
  const candidateSlots = businessDay ? await getSlotTimes() : [];
  const openSlots = await getOpenSlotsForStaff(staffId, date);
  const takenSlots = await getTakenSlots(staffId, date);

  res.json({ ok: true, date, businessDay, candidateSlots, openSlots, takenSlots, staffName: staff.name });
});

// ---------- 定休日・営業時間 ----------

router.get('/api/admin/settings', async (req, res) => {
  res.json({ ok: true, settings: await getSettings() });
});

router.post('/api/admin/settings', async (req, res) => {
  const { closedWeekdays, openHour, closeHour } = req.body || {};
  if (
    !Array.isArray(closedWeekdays) ||
    closedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    return res.status(400).json({ ok: false, error: 'invalid_closed_weekdays' });
  }
  const open = Number(openHour);
  const close = Number(closeHour);
  if (!Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close > 24 || open >= close) {
    return res.status(400).json({ ok: false, error: 'invalid_hours' });
  }
  const settings = await updateSettings({
    closedWeekdays: Array.from(new Set(closedWeekdays)),
    openHour: open,
    closeHour: close,
  });
  invalidateSettingsCache();
  res.json({ ok: true, settings });
});

// ---------- メニュー管理(共通カタログ) ----------

router.get('/api/admin/menus', async (req, res) => {
  res.json({ ok: true, menus: await listAllMenusAdmin() });
});

function parseDurationMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 30分刻みに切り上げる(例: 45分と入力されたら60分扱い)
  return Math.ceil(n / 30) * 30;
}

router.post('/api/admin/menus', async (req, res) => {
  const { label, price, durationMinutes } = req.body || {};
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (!trimmedLabel) return res.status(400).json({ ok: false, error: 'label_required' });
  const priceNum = price === '' || price === null || price === undefined ? null : Number(price);
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
    return res.status(400).json({ ok: false, error: 'invalid_price' });
  }
  const duration = parseDurationMinutes(durationMinutes) || 60;
  const menu = await createMenu({ label: trimmedLabel, price: priceNum, durationMinutes: duration });
  invalidateMenuCache();
  res.json({ ok: true, menu });
});

router.put('/api/admin/menus/:id', async (req, res) => {
  const { id } = req.params;
  const { label, price, durationMinutes, active } = req.body || {};
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (!trimmedLabel) return res.status(400).json({ ok: false, error: 'label_required' });
  const priceNum = price === '' || price === null || price === undefined ? null : Number(price);
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
    return res.status(400).json({ ok: false, error: 'invalid_price' });
  }
  const duration = parseDurationMinutes(durationMinutes) || 60;
  const menu = await updateMenu(id, { label: trimmedLabel, price: priceNum, durationMinutes: duration, active: active !== false });
  invalidateMenuCache();
  res.json({ ok: true, menu });
});

// ---------- スタッフごとのメニュー調整 ----------

router.get('/api/admin/staff/:id/menus', async (req, res) => {
  const staffId = Number(req.params.id);
  const staff = await getStaffById(staffId);
  if (!staff) return res.status(404).json({ ok: false, error: 'not_found' });
  const catalog = await listAllMenusAdmin();
  const overrides = await getStaffMenuOverrides(staffId);
  res.json({ ok: true, catalog, overrides });
});

router.post('/api/admin/staff/:id/menus', async (req, res) => {
  const staffId = Number(req.params.id);
  const staff = await getStaffById(staffId);
  if (!staff) return res.status(404).json({ ok: false, error: 'not_found' });
  const { overrides } = req.body || {};
  if (!Array.isArray(overrides)) return res.status(400).json({ ok: false, error: 'missing_fields' });

  for (const o of overrides) {
    if (!o || typeof o.menuId !== 'string') continue;
    const priceOverride =
      o.priceOverride === '' || o.priceOverride === null || o.priceOverride === undefined
        ? null
        : Number(o.priceOverride);
    if (priceOverride !== null && !Number.isFinite(priceOverride)) continue;
    await setStaffMenuOverride(staffId, o.menuId, {
      enabled: o.enabled !== false,
      priceOverride,
    });
  }
  invalidateMenuCache();
  res.json({ ok: true });
});

// ---------- メニュー診断クイズ ----------

router.get('/api/admin/quiz', async (req, res) => {
  res.json({ ok: true, questions: await listQuizQuestionsWithOptions() });
});

router.post('/api/admin/quiz/questions', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt_required' });
  const questions = await createQuizQuestion(prompt);
  res.json({ ok: true, questions });
});

router.put('/api/admin/quiz/questions/:id', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt_required' });
  const questions = await updateQuizQuestion(Number(req.params.id), prompt);
  res.json({ ok: true, questions });
});

router.delete('/api/admin/quiz/questions/:id', async (req, res) => {
  const questions = await deleteQuizQuestion(Number(req.params.id));
  res.json({ ok: true, questions });
});

router.post('/api/admin/quiz/questions/:id/options', async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  const menuId = typeof req.body?.menuId === 'string' ? req.body.menuId : '';
  if (!label || !menuId) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const questions = await createQuizOption(Number(req.params.id), label, menuId);
  res.json({ ok: true, questions });
});

router.put('/api/admin/quiz/options/:id', async (req, res) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  const menuId = typeof req.body?.menuId === 'string' ? req.body.menuId : '';
  if (!label || !menuId) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const questions = await updateQuizOption(Number(req.params.id), { label, menuId });
  res.json({ ok: true, questions });
});

router.delete('/api/admin/quiz/options/:id', async (req, res) => {
  const questions = await deleteQuizOption(Number(req.params.id));
  res.json({ ok: true, questions });
});

router.post('/api/admin/reservations/:id/confirm', async (req, res) => {
  const id = Number(req.params.id);
  const { reply } = req.body || {};
  const existing = await getReservation(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (existing.status === 'confirmed') {
    return res.json({ ok: true, reservation: existing });
  }

  const replyText = typeof reply === 'string' ? reply.trim().slice(0, 1000) : '';
  const reservation = await confirmReservation(id, replyText || null);
  const staff = reservation.staff_id ? await getStaffById(reservation.staff_id) : null;

  try {
    await pushText(
      reservation.line_user_id,
      `${reservation.name}様\nご予約が確定しました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        (staff ? `担当: ${staff.name}\n` : '') +
        `メニュー: ${await menuLabel(reservation.menu)}\n\n` +
        `ご来店を心よりお待ちしております。` +
        (reservation.reply_message ? `\n\n【ご相談へのご返信】\n${reservation.reply_message}` : '')
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
        `メニュー: ${await menuLabel(reservation.menu)}\n\n` +
        `ご不明な点がございましたら店舗までご連絡ください。`
    );
  } catch (err) {
    console.error('LINE push (キャンセル/admin) failed:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
module.exports.auth = auth;
