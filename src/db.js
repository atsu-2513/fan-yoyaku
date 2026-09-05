const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

// 本番(Vercel)は Turso(libSQL) のリモートDB、ローカル開発は環境変数未設定なら
// data/fan-yoyaku.db をファイルDBとして使う（Vercelのサーバーレス環境は
// ファイルシステムが永続化されないため、本番では必ず TURSO_DATABASE_URL を設定すること）。
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '..', 'data', 'fan-yoyaku.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const TOKEN_TTL_MINUTES = 30;

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = client.batch(
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
      ],
      'write'
    );
  }
  return readyPromise;
}

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

async function isSlotTaken(date, time) {
  await ready();
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM reservations
          WHERE date = ? AND time = ? AND status != 'cancelled'`,
    args: [date, time],
  });
  return Number(result.rows[0].c) > 0;
}

async function getTakenSlots(date) {
  await ready();
  const result = await client.execute({
    sql: `SELECT time FROM reservations WHERE date = ? AND status != 'cancelled'`,
    args: [date],
  });
  return result.rows.map((r) => r.time);
}

async function createReservation({ lineUserId, date, time, menu, name, phone }) {
  await ready();
  const insert = await client.execute({
    sql: `INSERT INTO reservations (line_user_id, date, time, menu, name, phone, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [lineUserId, date, time, menu, name, phone, new Date().toISOString()],
  });
  return getReservation(Number(insert.lastInsertRowid));
}

async function listReservations() {
  await ready();
  const result = await client.execute(
    `SELECT * FROM reservations ORDER BY date ASC, time ASC, id ASC`
  );
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
  isSlotTaken,
  getTakenSlots,
  createReservation,
  listReservations,
  getReservation,
  confirmReservation,
};
