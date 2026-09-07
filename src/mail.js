// メール通知(新規予約が入った時に、担当スタッフとオーナーに送る)。
// 追加のnpmパッケージを使わず、Brevo(旧Sendinblue)のAPIをfetch()で直接呼び出す。
// Brevoは「送信元アドレスの認証」(6桁コードでの確認)だけで、独自ドメインを持っていなくても
// 任意の宛先(スタッフやオーナーの個人メールアドレスなど)にメールを送れるため採用している。
//
// 必要な環境変数:
//   BREVO_API_KEY      Brevoの管理画面(SMTP & API > APIキー)で発行するキー
//   MAIL_FROM_ADDRESS  Brevoで「送信者」として認証したメールアドレス
//   MAIL_FROM_NAME     送信者名(任意。未設定なら「hair salon FAN」)
//   OWNER_EMAIL        オーナーの通知先メールアドレス(booking.js側で使用)
//
// これらが未設定の場合は、エラーにはせず送信をスキップする(LINE通知は動き続ける)。

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendMail({ to, subject, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromAddress = process.env.MAIL_FROM_ADDRESS;

  if (!apiKey || !fromAddress) {
    console.warn('メール送信をスキップしました(BREVO_API_KEY または MAIL_FROM_ADDRESS が未設定です)');
    return;
  }

  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return;

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { email: fromAddress, name: process.env.MAIL_FROM_NAME || 'hair salon FAN' },
      to: recipients.map((email) => ({ email })),
      subject,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevoへのメール送信に失敗しました: ${res.status} ${body}`);
  }
}

module.exports = { sendMail };
