const express = require('express');
const {
  getValidToken,
  markTokenUsed,
  getTakenSlots,
  getTakenSlotsForRange,
  createReservation,
  listActiveStaff,
  getStaffById,
  getOpenSlotsForStaff,
  getOpenSlotsForStaffRange,
  listMenusForStaff,
} = require('../db');
const { isBusinessDay, slotsForDate, menuLabel, todayJST } = require('../businessHours');
const { computeAvailableStartTimes } = require('../availability');
const { pushText } = require('../line');
const { sendMail } = require('../mail');

const router = express.Router();

// トークンが有効か確認（予約ページ読み込み時に使用）。あわせて指名可能なスタッフ一覧も返す。
// メニューはスタッフごとに内容・価格・施術時間が異なりうるため、ここでは返さない(スタッフ選択後に別途取得)。
router.get('/api/booking/token/:token', async (req, res) => {
  const row = await getValidToken(req.params.token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  const staff = await listActiveStaff();
  res.json({ ok: true, staff });
});

// 指名したスタッフに実際に提供されるメニュー一覧(価格・施術時間込み)を返す
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

// 指定スタッフ・指定日・指定メニュー(施術時間)の、実際に予約可能な開始時刻の一覧を返す
// (そのスタッフが開放していて、かつ施術時間ぶん連続して他の予約と重ならない時刻だけを返す)
router.get('/api/booking/availability', async (req, res) => {
  const { token, date, staffId, menu } = req.query;
  const row = await getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  if (!date) return res.status(400).json({ ok: false, error: 'date_required' });
  const staffIdNum = Number(staffId);
  if (!staffIdNum) return res.status(400).json({ ok: false, error: 'staff_required' });
  const staff = await getStaffById(staffIdNum);
  if (!staff || !staff.active) return res.status(400).json({ ok: false, error: 'invalid_staff' });

  const staffMenus = await listMenusForStaff(staffIdNum);
  const selectedMenu = staffMenus.find((m) => m.id === menu);
  if (!selectedMenu) return res.status(400).json({ ok: false, error: 'invalid_menu' });

  if (!(await isBusinessDay(date))) {
    return res.json({ ok: true, date, businessDay: false, slots: [] });
  }

  const candidateSlots = await slotsForDate(date);
  const openSlots = await getOpenSlotsForStaff(staffIdNum, date);
  const takenSlots = await getTakenSlots(staffIdNum, date);
  const available = computeAvailableStartTimes({
    candidateSlots,
    openSlots,
    takenSlots,
    durationMinutes: selectedMenu.durationMinutes,
  });
  res.json({ ok: true, date, businessDay: true, slots: available });
});

// カレンダーに「空きあり(○)」を表示するための、指定月まとめの空き状況を返す
// (1日ずつ問い合わせるとスタッフ・メニュー切り替えのたびに遅くなるため、月まとめで1回のクエリにする)
router.get('/api/booking/availability-month', async (req, res) => {
  const { token, staffId, menu, year, month } = req.query;
  const row = await getValidToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  const staffIdNum = Number(staffId);
  if (!staffIdNum) return res.status(400).json({ ok: false, error: 'staff_required' });
  const staff = await getStaffById(staffIdNum);
  if (!staff || !staff.active) return res.status(400).json({ ok: false, error: 'invalid_staff' });

  const staffMenus = await listMenusForStaff(staffIdNum);
  const selectedMenu = staffMenus.find((m) => m.id === menu);
  if (!selectedMenu) return res.status(400).json({ ok: false, error: 'invalid_menu' });

  const y = Number(year);
  const mo = Number(month);
  if (!y || !mo || mo < 1 || mo > 12) return res.status(400).json({ ok: false, error: 'invalid_month' });

  const pad2 = (n) => String(n).padStart(2, '0');
  const daysInMonth = new Date(y, mo, 0).getDate();
  const startDate = `${y}-${pad2(mo)}-01`;
  const endDate = `${y}-${pad2(mo)}-${pad2(daysInMonth)}`;
  const today = todayJST();

  const openByDate = await getOpenSlotsForStaffRange(staffIdNum, startDate, endDate);
  const takenByDate = await getTakenSlotsForRange(staffIdNum, startDate, endDate);

  const days = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${pad2(mo)}-${pad2(d)}`;
    if (dateStr < today) continue; // 過去日は画面側で選択不可のため計算しない
    if (!(await isBusinessDay(dateStr))) {
      days[dateStr] = 'closed';
      continue;
    }
    const candidateSlots = await slotsForDate(dateStr);
    const available = computeAvailableStartTimes({
      candidateSlots,
      openSlots: openByDate[dateStr] || [],
      takenSlots: takenByDate[dateStr] || [],
      durationMinutes: selectedMenu.durationMinutes,
    });
    days[dateStr] = available.length > 0 ? 'available' : 'none';
  }
  res.json({ ok: true, year: y, month: mo, days });
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
  const staffMenus = await listMenusForStaff(staffIdNum);
  const selectedMenu = staffMenus.find((m) => m.id === menu);
  if (!selectedMenu) {
    return res.status(400).json({ ok: false, error: 'invalid_menu' });
  }
  if (!(await isBusinessDay(date))) {
    return res.status(400).json({ ok: false, error: 'invalid_date_or_time' });
  }
  const candidateSlots = await slotsForDate(date);
  const openSlots = await getOpenSlotsForStaff(staffIdNum, date);
  const takenSlots = await getTakenSlots(staffIdNum, date);
  const available = computeAvailableStartTimes({
    candidateSlots,
    openSlots,
    takenSlots,
    durationMinutes: selectedMenu.durationMinutes,
  });
  if (!available.includes(time)) {
    return res.status(409).json({ ok: false, error: 'slot_taken' });
  }
  const phonePattern = /^[0-9-]{9,14}$/;
  if (!phonePattern.test(phone)) {
    return res.status(400).json({ ok: false, error: 'invalid_phone' });
  }
  const consultationText = typeof consultation === 'string' ? consultation.trim().slice(0, 1000) : '';

  const reservation = await createReservation({
    lineUserId: row.line_user_id,
    staffId: staffIdNum,
    date,
    time,
    menu,
    name: String(name).trim(),
    phone: String(phone).trim(),
    consultation: consultationText || null,
    durationMinutes: selectedMenu.durationMinutes,
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
