const express = require('express');
const {
  getValidToken,
  markTokenUsed,
  isSlotTaken,
  getTakenSlots,
  createReservation,
  listActiveStaff,
  getStaffById,
  getOpenSlotsForStaff,
  listMenusForStaff,
} = require('../db');
const { isBusinessDay, menuLabel } = require('../businessHours');
const { pushText } = require('../line');
const { sendMail } = require('../mail');

const router = express.Router();

// トークンが有効か確認（予約ページ読み込み時に使用）。あわせて指名可能なスタッフ一覧も返す。
// メニューはスタッフごとに内容・価格が異なりうるため、ここでは返さない(スタッフ選択後に別途取得)。
router.get('/api/booking/token/:token', async (req, res) => {
  const row = await getValidToken(req.params.token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  const staff = await listActiveStaff();
  res.json({ ok: true, staff });
});

// 指名したスタッフに実際に提供されるメニュー一覧(価格込み)を返す
router.get('/api/booking/menus', async (req, res) => {
  const { token, staffId } = req.query;
  const row = await getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  const staffIdNum = Number(staffId);
  if (!staffIdNum) return res.status(400).json({ ok: false, error: 'staff_required' });
  const staff = await getStaffById(staffIdNum);
  if (!staff || !staff.active) return res.status(400).json({ ok: false, error: 'invalid_staff' });
  const menus = await listMenusForStaff(staffIdNum);
  res.json({ ok: true, menus });
});

// 指定スタッフ・指定日の空き状況を返す（そのスタッフが自分で解放した時間のうち、未予約のもの）
router.get('/api/booking/availability', async (req, res) => {
  const { token, date, staffId } = req.query;
  const row = await getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });
  const staffIdNum = Number(staffId);
  if (!staffIdNum) return res.status(400).json({ ok: false, error: 'staff_required' });
  const staff = await getStaffById(staffIdNum);
  if (!staff || !staff.active) return res.status(400).json({ ok: false, error: 'invalid_staff' });

  if (!(await isBusinessDay(date))) {
    return res.json({ ok: true, date, businessDay: false, slots: [] });
  }

  const openSlots = await getOpenSlotsForStaff(staffIdNum, date);
  const taken = new Set(await getTakenSlots(staffIdNum, date));
  const available = openSlots.filter((t) => !taken.has(t)).sort();
  res.json({ ok: true, date, businessDay: true, slots: available });
});

// 予約作成
router.post('/api/booking', async (req, res) => {
  const { token, staffId, date, time, menu, name, phone, consultation } = req.body || {};

  const row = await getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });

  const staffIdNum = Number(staffId);
  if (!staffIdNum || !date || !time || !menu || !name || !phone) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  const staff = await getStaffById(staffIdNum);
  if (!staff || !staff.active) {
    return res.status(400).json({ ok: false, error: 'invalid_staff' });
  }
  if (!(await isBusinessDay(date))) {
    return res.status(400).json({ ok: false, error: 'invalid_date_or_time' });
  }
  const openSlots = await getOpenSlotsForStaff(staffIdNum, date);
  if (!openSlots.includes(time)) {
    return res.status(400).json({ ok: false, error: 'invalid_date_or_time' });
  }
  const staffMenus = await listMenusForStaff(staffIdNum);
  if (!staffMenus.some((m) => m.id === menu)) {
    return res.status(400).json({ ok: false, error: 'invalid_menu' });
  }
  const phonePattern = /^[0-9-]{9,14}$/;
  if (!phonePattern.test(phone)) {
    return res.status(400).json({ ok: false, error: 'invalid_phone' });
  }
  const consultationText = typeof consultation === 'string' ? consultation.trim().slice(0, 1000) : '';
  if (await isSlotTaken(staffIdNum, date, time)) {
    return res.status(409).json({ ok: false, error: 'slot_taken' });
  }

  const reservation = await createReservation({
    lineUserId: row.line_user_id,
    staffId: staffIdNum,
    date,
    time,
    menu,
    name: String(name).trim(),
    phone: String(phone).trim(),
    consultation: consultationText || null,
  });
  await markTokenUsed(token);

  try {
    await pushText(
      row.line_user_id,
      `${reservation.name}様\n仮予約を受け付けました。\n\n` +
        `日時: ${reservation.date} ${reservation.time}\n` +
        `担当: ${staff.name}\n` +
        `メニュー: ${await menuLabel(reservation.menu)}\n\n` +
        `店舗からの確定連絡をお待ちください。`
    );
  } catch (err) {
    console.error('LINE push (仮予約) failed:', err);
  }

  try {
    const recipients = [staff.email, process.env.OWNER_EMAIL].filter(Boolean);
    if (recipients.length) {
      await sendMail({
        to: recipients,
        subject: `【新規予約】${reservation.date} ${reservation.time} ${staff.name}様指名`,
        text:
          `新しいご予約が入りました。\n\n` +
          `日時: ${reservation.date} ${reservation.time}\n` +
          `担当: ${staff.name}\n` +
          `メニュー: ${await menuLabel(reservation.menu)}\n` +
          `お名前: ${reservation.name}\n` +
          `電話番号: ${reservation.phone}\n` +
          (consultationText ? `\nご相談内容:\n${consultationText}\n` : '') +
          (process.env.BASE_URL ? `\n管理画面で確認: ${process.env.BASE_URL}/admin/` : ''),
      });
    }
  } catch (err) {
    console.error('メール通知(新規予約)の送信に失敗しました:', err);
  }

  res.json({ ok: true, reservation });
});

module.exports = router;
