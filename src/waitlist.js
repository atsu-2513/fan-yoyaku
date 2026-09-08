// キャンセルで枠が空いた時に、その枠を「第一希望」にしていた候補日リクエストを探し、
// オーナー・担当スタッフへメールで知らせる(空き通知)ためのヘルパー。
// admin.js / staff.js の両方のキャンセル処理から呼び出される。
const { findWaitlistMatches, createWaitlistAlert, getStaffById } = require('./db');
const { sendMail } = require('./mail');

async function checkAndCreateWaitlistAlerts(cancelledReservation) {
  if (!cancelledReservation || !cancelledReservation.staff_id) return [];
  const matches = await findWaitlistMatches(
    cancelledReservation.staff_id,
    cancelledReservation.date,
    cancelledReservation.time
  );
  if (matches.length === 0) return [];

  const alerts = [];
  for (const match of matches) {
    const alert = await createWaitlistAlert({
      requestId: match.id,
      staffId: cancelledReservation.staff_id,
      date: cancelledReservation.date,
      time: cancelledReservation.time,
    });
    alerts.push(alert);
  }

  try {
    const staff = await getStaffById(cancelledReservation.staff_id);
    const recipients = [staff && staff.email, process.env.OWNER_EMAIL].filter(Boolean);
    if (recipients.length) {
      const names = matches.map((m) => `${m.name}様(第一希望)`).join('、');
      await sendMail({
        to: recipients,
        subject: `【空き通知】${cancelledReservation.date} ${cancelledReservation.time} ${staff ? staff.name : ''}に空きが出ました`,
        text:
          `キャンセルにより以下の枠が空きました。\n\n` +
          `日時: ${cancelledReservation.date} ${cancelledReservation.time}\n` +
          `担当: ${staff ? staff.name : ''}\n\n` +
          `この日時を第一希望にしていたお客様がいます: ${names}\n` +
          `管理画面・スタッフ画面の「空き通知」から、ご案内メッセージを送れます。`,
      });
    }
  } catch (err) {
    console.error('メール通知(空き通知)の送信に失敗しました:', err);
  }

  return alerts;
}

module.exports = { checkAndCreateWaitlistAlerts };
