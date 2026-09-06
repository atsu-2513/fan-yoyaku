// スタッフアカウントの初期作成スクリプト。
// 使い方: node scripts/create-staff.js
// すでに存在するユーザー名はスキップされるので、何度実行しても安全です。
// 発行された初期パスワードはこのスクリプトの出力にのみ表示されます。
// 各スタッフに伝えたら、スタッフ画面の「パスワード変更」から変更してもらってください。

require('dotenv').config();
const { createStaffAccount, getStaffByUsername } = require('../src/db');
const { hashPassword } = require('../src/auth');

// ここに追加・変更したいスタッフを書けば、そのまま反映されます。
const STAFF = [
  { name: '吉川', username: 'yoshikawa' },
  { name: '中村', username: 'nakamura' },
  { name: '杉岡', username: 'sugioka' },
];

function randomPassword() {
  return Math.random().toString(36).slice(-8);
}

(async () => {
  console.log('--- スタッフアカウント作成 ---');
  for (const s of STAFF) {
    const existing = await getStaffByUsername(s.username);
    if (existing) {
      console.log(`skip（既に存在します）: ${s.username}（${s.name}）`);
      continue;
    }
    const password = randomPassword();
    await createStaffAccount({ name: s.name, username: s.username, passwordHash: hashPassword(password) });
    console.log(`作成しました: ${s.name} / ID: ${s.username} / 初期パスワード: ${password}`);
  }
  console.log('--- 完了 ---');
  process.exit(0);
})().catch((err) => {
  console.error('スタッフ作成中にエラーが発生しました:', err);
  process.exit(1);
});
