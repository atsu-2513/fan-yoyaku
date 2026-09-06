const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

// 本番(Render)は Turso(libSQL) のリモートDB、ローカル開発は環境変数未設定なら
// data/fan-yoyaku.db をファイルDBとして使う（サーバーレス/コンテナ環境は
// ファイルシステムが永続化されない場合があるため、本番では必ず TURSO_DATABASE_URL を設定すること）。
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '..', 'data', 'fan-yoyaku.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const TOKEN_TTL_MINUTES = 30;

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await client.batch(
        [
          `CREATE TABLE IF NOT EXISTS booking_tokens (
            token TEXT PRIMARY KEY,
            line_user_id TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            line_user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            menu TEXT NOT NULL,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS staff (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS staff_open_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(staff_id, date, time)
          )`,
        ],
        'write'
      );

      // 既存の reservations テーブルに staff_id 列がなければ追加する（後方互換マイグレーション）
      const columns = await client.execute(`PRAGMA table_info(reservations)`);
      const hasStaffId = columns.rows.some((c) => c.name === 'staff_id');
      if (!hasStaffId) {
        await client.execute(`ALTER TABLE reservations ADD COLUMN staff_id INTEGER`);
      }
    })();
  }
  return readyPromise;
}

// ---------- 予約トークン(LINEからの導線) ----------

async function createBookingToken(lineUserId) {
  await ready();
  const token = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);
  await client.execute({
    sql: `INSERT INTO booking_tokens (token, line_user_id, used, created_at, expires_at)
          VALUES (?, ?, 0, ?, ?)`,
    args: [token, lineUserId, now.toISOString(), expires.toISOString()],
  });
  return token;
}

async function getValidToken(token) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM booking_tokens WHERE token = ?`,
    args: [token],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

async function markTokenUsed(token) {
  await ready();
  await client.execute({
    sql: `UPDATE booking_tokens SET used = 1 WHERE token = ?`,
    args: [token],
  });
}

// ---------- スタッフ ----------

async function createStaffAccount({ name, username, passwordHash }) {
  await ready();
  const insert = await client.execute({
    sql: `INSERT INTO staff (name, username, password_hash, active, created_at)
          VALUES (?, ?, ?, 1, ?)`,
    args: [name, username, passwordHash, new Date().toISOString()],
  });
  return getStaffById(Number(insert.lastInsertRowid));
}

async function getStaffByUsername(username) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM staff WHERE username = ?`,
    args: [username],
  });
  return result.rows[0] || null;
}

async function getStaffById(id) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM staff WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] || null;
}

async function listActiveStaff() {
  await ready();
  const result = await client.execute(
    `SELECT id, name FROM staff WHERE active = 1 ORDER BY id ASC`
  );
  return result.rows;
}

async function listAllStaff() {
  await ready();
  const result = await client.execute(`SELECT id, name, username, active FROM staff ORDER BY id ASC`);
  return result.rows;
}

async function updateStaffPassword(id, passwordHash) {
  await ready();
  await client.execute({
    sql: `UPDATE staff SET password_hash = ? WHERE id = ?`,
    args: [passwordHash, id],
  });
}

// ---------- スタッフの空き時間(自分で解放した枠) ----------

async function openSlot(staffId, date, time) {
  await ready();
  await client.execute({
    sql: `INSERT OR IGNORE INTO staff_open_slots (staff_id, date, time, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [staffId, date, time, new Date().toISOString()],
  });
}

async function closeSlot(staffId, date, time) {
  await ready();
  await client.execute({
    sql: `DELETE FROM staff_open_slots WHERE staff_id = ? AND date = ? AND time = ?`,
    args: [staffId, date, time],
  });
}

async function getOpenSlotsForStaff(staffId, date) {
  await ready();
  const result = await client.execute({
    sql: `SELECT time FROM staff_open_slots WHERE staff_id = ? AND date = ? ORDER BY time ASC`,
    args: [staffId, date],
  });
  return result.rows.map((r) => r.time);
}

async function isSlotOpenForStaff(staffId, date, time) {
  const open = await getOpenSlotsForStaff(staffId, date);
  return open.includes(time);
}

// ---------- 予約 ----------

async function isSlotTaken(staffId, date, time) {
  await ready();
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM reservations
          WHERE staff_id = ? AND date = ? AND time = ? AND status != 'cancelled'`,
    args: [staffId, date, time],
  });
  return Number(result.rows[0].c) > 0;
}

async function getTakenSlots(staffId, date) {
  await ready();
  const result = await client.execute({
    sql: `SELECT time FROM reservations WHERE staff_id = ? AND date = ? AND status != 'cancelled'`,
    args: [staffId, date],
  });
  return result.rows.map((r) => r.time);
}

async function createReservation({ lineUserId, staffId, date, time, menu, name, phone }) {
  await ready();
  const insert = await client.execute({
    sql: `INSERT INTO reservations (line_user_id, staff_id, date, time, menu, name, phone, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [lineUserId, staffId, date, time, menu, name, phone, new Date().toISOString()],
  });
  return getReservation(Number(insert.lastInsertRowid));
}

// 管理画面(オーナー)用: 全予約 + 担当スタッフ名を付けて返す
async function listReservationsWithStaff() {
  await ready();
  const result = await client.execute(
    `SELECT r.*, s.name AS staff_name
     FROM reservations r
     LEFT JOIN staff s ON s.id = r.staff_id
     ORDER BY r.date ASC, r.time ASC, r.id ASC`
  );
  return result.rows;
}

// スタッフ画面用: 自分の予約だけ
async function listReservationsForStaff(staffId) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM reservations WHERE staff_id = ? ORDER BY date ASC, time ASC, id ASC`,
    args: [staffId],
  });
  return result.rows;
}

async function getReservation(id) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM reservations WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] || null;
}

async function confirmReservation(id) {
  await ready();
  await client.execute({
    sql: `UPDATE reservations SET status = 'confirmed' WHERE id = ?`,
    args: [id],
  });
  return getReservation(id);
}

module.exports = {
  client,
  createBookingToken,
  getValidToken,
  markTokenUsed,
  createStaffAccount,
  getStaffByUsername,
  getStaffById,
  listActiveStaff,
  listAllStaff,
  updateStaffPassword,
  openSlot,
  closeSlot,
  getOpenSlotsForStaff,
  isSlotOpenForStaff,
  isSlotTaken,
  getTakenSlots,
  createReservation,
  listReservationsWithStaff,
  listReservationsForStaff,
  getReservation,
  confirmReservation,
};
