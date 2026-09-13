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
  getLineUserIdForCustomer,
  listQuizQuestionsWithOptions,
  createQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  createQuizOption,
  updateQuizOption,
  deleteQuizOption,
  listMenusForStaff,
  getCandidateRequest,
  listAllCandidateRequestsWithStaff,
  confirmCandidateRequest,
  declineCandidateRequest,
  listAllOpenWaitlistAlerts,
  getWaitlistAlert,
  markWaitlistAlertStatus,
  updateReservationDateTime,
  listShopCategories,
  createShopCategory,
  updateShopCategory,
  deleteShopCategory,
  setShopProductRecommendations,
  listAllShopProductsAdmin,
  createShopProduct,
  updateShopProduct,
  deleteShopProduct,
  getShopProductById,
  listAllShopOrdersWithStaff,
  markShopOrderStatus,
} = require('../db');
const {
  menuLabel,
  isBusinessDay,
  slotsForDate,
  getSlotTimes,
  invalidateSettingsCache,
  invalidateMenuCache,
} = require('../businessHours');
const { computeAvailableStartTimes, expandRange } = require('../availability');
const { pushText } = require('../line');
const { checkAndCreateWaitlistAlerts } = require('../waitlist');

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

// 予約の日時変更(reschedule)パネル用: 指定日の、この予約自身の枠は空きとして扱った空き時間一覧
router.get('/api/admin/reservations/:id/availability', async (req, res) => {
  const id = Number(req.params.id);
  const { date } = req.query;
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });
  const existing = await getReservation(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!(await isBusinessDay(date))) {
    return res.json({ ok: true, date, businessDay: false, slots: [] });
  }
  const staffMenus = await listMenusForStaff(existing.staff_id);
  const selectedMenu = staffMenus.find((m) => m.id === existing.menu);
  const durationMinutes = (selectedMenu && selectedMenu.durationMinutes) || existing.duration_minutes || 60;
  const candidateSlots = await slotsForDate(date);
  const openSlots = await getOpenSlotsForStaff(existing.staff_id, date);
  const takenSlotsRaw = await getTakenSlots(existing.staff_id, date);
  const ownSlots = new Set(existing.date === date ? expandRange(existing.time, durationMinutes) : []);
  const takenSlots = takenSlotsRaw.filter((t) => !ownSlots.has(t));
  const available = computeAvailableStartTimes({ candidateSlots, openSlots, takenSlots, durationMinutes });
  res.json({ ok: true, date, businessDay: true, slots: available });
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

// お客様に任意のタイミングでLINEメッセージを送る(オーナーはどのスタッフのお客様にも送れる)
router.post('/api/admin/customers/:id/message', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCustomerById(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  if (!message) return res.status(400).json({ ok: false, error: 'message_required' });

  const lineUserId = await getLineUserIdForCustomer(existing.staff_id, existing.phone);
  if (!lineUserId) return res.status(400).json({ ok: false, error: 'no_line_user' });

  try {
    await pushText(lineUserId, message);
  } catch (err) {
    console.error('LINE push (顧客への任意メッセージ/admin) failed:', err);
    return res.status(502).json({ ok: false, error: 'line_push_failed' });
  }

  res.json({ ok: true });
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

  try {
    await checkAndCreateWaitlistAlerts(reservation);
  } catch (err) {
    console.error('空き通知チェックに失敗しました:', err);
  }

  res.json({ ok: true, reservation });
});

// ---------- 候補日リクエスト(お客様が複数の希望日時を提示し、スタッフ/オーナーが1つ確定する) ----------
router.get('/api/admin/candidate-requests', async (req, res) => {
  const requests = await listAllCandidateRequestsWithStaff();
  res.json({ ok: true, requests });
});

router.post('/api/admin/candidate-requests/:id/confirm', async (req, res) => {
  const id = Number(req.params.id);
  const rank = Number(req.body?.rank);
  const existing = await getCandidateRequest(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (existing.status !== 'pending') {
    return res.status(409).json({ ok: false, error: 'already_handled' });
  }
  const chosen = existing.dates.find((d) => Number(d.rank) === rank);
  if (!chosen) return res.status(400).json({ ok: false, error: 'invalid_rank' });

  const staff = await getStaffById(existing.staff_id);
  if (!staff) return res.status(400).json({ ok: false, error: 'invalid_staff' });

  // 確定直前に、他の予約とまだ重なっていないか再確認する
  const staffMenus = await listMenusForStaff(existing.staff_id);
  const selectedMenu = staffMenus.find((m) => m.id === existing.menu);
  const durationMinutes = (selectedMenu && selectedMenu.durationMinutes) || existing.duration_minutes || 60;
  const candidateSlots = await slotsForDate(chosen.date);
  const openSlots = await getOpenSlotsForStaff(existing.staff_id, chosen.date);
  const takenSlots = await getTakenSlots(existing.staff_id, chosen.date);
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
        '担当: ' + staff.name + '\n' +
        'メニュー: ' + (await menuLabel(reservation.menu)) + '\n\n' +
        'ご来店を心よりお待ちしております。'
    );
  } catch (err) {
    console.error('LINE push (候補日確定) failed:', err);
  }

  res.json({ ok: true, request: confirmed.request, reservation });
});

router.post('/api/admin/candidate-requests/:id/decline', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getCandidateRequest(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
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
    console.error('LINE push (候補日見送り) failed:', err);
  }

  res.json({ ok: true, request });
});

// ---------- 空き通知(キャンセルで第一希望の枠が空いた場合の通知・お声がけ) ----------
router.get('/api/admin/waitlist-alerts', async (req, res) => {
  const alerts = await listAllOpenWaitlistAlerts();
  res.json({ ok: true, alerts });
});

router.post('/api/admin/waitlist-alerts/:id/notify', async (req, res) => {
  const id = Number(req.params.id);
  const alert = await getWaitlistAlert(id);
  if (!alert) return res.status(404).json({ ok: false, error: 'not_found' });
  const customMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const message = customMessage
    ? customMessage.slice(0, 1000)
    : alert.name + '様\nご希望されていた ' + alert.date + ' ' + alert.time + ' に空きが出ました。\n' +
      'ご都合がよろしければ、このメッセージにご返信いただくか、店舗までご連絡ください。';

  try {
    await pushText(alert.line_user_id, message);
  } catch (err) {
    console.error('LINE push (空き通知) failed:', err);
    return res.status(502).json({ ok: false, error: 'line_push_failed' });
  }

  const updated = await markWaitlistAlertStatus(id, 'contacted');
  res.json({ ok: true, alert: updated });
});

router.post('/api/admin/waitlist-alerts/:id/dismiss', async (req, res) => {
  const id = Number(req.params.id);
  const updated = await markWaitlistAlertStatus(id, 'dismissed');
  if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, alert: updated });
});

// ---------- 予約日時の変更(画面上でそのまま変更する。キャンセル+再予約の代わり) ----------
router.post('/api/admin/reservations/:id/reschedule', async (req, res) => {
  const id = Number(req.params.id);
  const { date, time } = req.body || {};
  if (!date || !time) return res.status(400).json({ ok: false, error: 'missing_fields' });
  const existing = await getReservation(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  if (existing.status === 'cancelled') {
    return res.status(409).json({ ok: false, error: 'already_cancelled' });
  }
  if (!(await isBusinessDay(date))) {
    return res.status(400).json({ ok: false, error: 'invalid_date_or_time' });
  }
  const staffMenus = await listMenusForStaff(existing.staff_id);
  const selectedMenu = staffMenus.find((m) => m.id === existing.menu);
  const durationMinutes = (selectedMenu && selectedMenu.durationMinutes) || existing.duration_minutes || 60;
  const candidateSlots = await slotsForDate(date);
  const openSlots = await getOpenSlotsForStaff(existing.staff_id, date);
  const takenSlotsRaw = await getTakenSlots(existing.staff_id, date);
  // 変更先が同じ日の場合、自分自身が今使っている枠は「空き」として扱う
  const ownSlots = new Set(existing.date === date ? expandRange(existing.time, durationMinutes) : []);
  const takenSlots = takenSlotsRaw.filter((t) => !ownSlots.has(t));
  const available = computeAvailableStartTimes({ candidateSlots, openSlots, takenSlots, durationMinutes });
  if (!available.includes(time)) {
    return res.status(409).json({ ok: false, error: 'slot_taken' });
  }

  const reservation = await updateReservationDateTime(id, { date, time });

  try {
    const staff = existing.staff_id ? await getStaffById(existing.staff_id) : null;
    await pushText(
      reservation.line_user_id,
      reservation.name + '様\nご予約の日時を変更いたしました。\n\n' +
        '変更後: ' + reservation.date + ' ' + reservation.time + '\n' +
        (staff ? '担当: ' + staff.name + '\n' : '') +
        'メニュー: ' + (await menuLabel(reservation.menu)) + '\n\n' +
        'ご不明な点がございましたら店舗までご連絡ください。'
    );
  } catch (err) {
    console.error('LINE push (日時変更) failed:', err);
  }

  res.json({ ok: true, reservation });
});

// ---------- 店販(カテゴリー・商品管理・注文リクエスト) ----------

router.get('/api/admin/shop-categories', async (req, res) => {
  res.json({ ok: true, categories: await listShopCategories() });
});

router.post('/api/admin/shop-categories', async (req, res) => {
  const { label } = req.body || {};
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (!trimmedLabel) return res.status(400).json({ ok: false, error: 'label_required' });
  const category = await createShopCategory(trimmedLabel);
  res.json({ ok: true, category });
});

router.put('/api/admin/shop-categories/:id', async (req, res) => {
  const { label } = req.body || {};
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  if (!trimmedLabel) return res.status(400).json({ ok: false, error: 'label_required' });
  const category = await updateShopCategory(req.params.id, trimmedLabel);
  if (!category) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, category });
});

router.delete('/api/admin/shop-categories/:id', async (req, res) => {
  await deleteShopCategory(req.params.id);
  res.json({ ok: true });
});

router.get('/api/admin/shop-products', async (req, res) => {
  res.json({ ok: true, products: await listAllShopProductsAdmin() });
});

router.post('/api/admin/shop-products', async (req, res) => {
  const { name, price, description, photoData, categoryId, staffIds } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return res.status(400).json({ ok: false, error: 'name_required' });
  const priceNum = price === '' || price === null || price === undefined ? null : Number(price);
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
    return res.status(400).json({ ok: false, error: 'invalid_price' });
  }
  const cleanStaffIds = Array.isArray(staffIds) ? staffIds.map(Number).filter((n) => Number.isInteger(n)) : [];
  const product = await createShopProduct({
    name: trimmedName,
    price: priceNum,
    description: typeof description === 'string' ? description.trim().slice(0, 1000) : '',
    photoData: typeof photoData === 'string' ? photoData : null,
    categoryId: typeof categoryId === 'string' && categoryId ? categoryId : null,
  });
  await setShopProductRecommendations(product.id, cleanStaffIds);
  res.json({ ok: true, product: await getShopProductById(product.id) });
});

router.put('/api/admin/shop-products/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getShopProductById(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  const { name, price, description, photoData, active, categoryId, staffIds } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return res.status(400).json({ ok: false, error: 'name_required' });
  const priceNum = price === '' || price === null || price === undefined ? null : Number(price);
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
    return res.status(400).json({ ok: false, error: 'invalid_price' });
  }
  // 写真を新しく送ってきた時だけ差し替える(未指定なら既存の写真をそのまま残す)
  const keepExistingPhoto = typeof photoData !== 'string';
  const product = await updateShopProduct(id, {
    name: trimmedName,
    price: priceNum,
    description: typeof description === 'string' ? description.trim().slice(0, 1000) : '',
    photoData: keepExistingPhoto ? undefined : photoData,
    active: active !== false,
    keepExistingPhoto,
    categoryId: typeof categoryId === 'string' && categoryId ? categoryId : null,
  });
  if (Array.isArray(staffIds)) {
    const cleanStaffIds = staffIds.map(Number).filter((n) => Number.isInteger(n));
    await setShopProductRecommendations(id, cleanStaffIds);
  }
  res.json({ ok: true, product: await getShopProductById(id) });
});

router.delete('/api/admin/shop-products/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getShopProductById(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
  await deleteShopProduct(id);
  res.json({ ok: true });
});

router.get('/api/admin/shop-orders', async (req, res) => {
  res.json({ ok: true, orders: await listAllShopOrdersWithStaff() });
});

router.post('/api/admin/shop-orders/:id/complete', async (req, res) => {
  const id = Number(req.params.id);
  await markShopOrderStatus(id, 'done');
  res.json({ ok: true });
});

module.exports = router;
module.exports.auth = auth;
