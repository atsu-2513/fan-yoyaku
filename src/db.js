const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'fan-yoyaku.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS booking_tokens (
    token TEXT PRIMARY KEY,
    line_user_id TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    menu TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
`);

const TOKEN_TTL_MINUTES = 30;

function createBookingToken(lineUserId) {
  const token = require('crypto').randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);
  db.prepare(
    `INSERT INTO booking_tokens (token, line_user_id, used, created_at, expires_at)
     VALUES (?, ?, 0, ?, ?)`
  ).run(token, lineUserId, now.toISOString(), expires.toISOString());
  return token;
}

function getValidToken(token) {
  const row = db.prepare(`SELECT * FROM booking_tokens WHERE token = ?`).get(token);
  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

function markTokenUsed(token) {
  db.prepare(`UPDATE booking_tokens SET used = 1 WHERE token = ?`).run(token);
}

function isSlotTaken(date, time) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM reservations
       WHERE date = ? AND time = ? AND status != 'cancelled'`
    )
    .get(date, time);
  return row.c > 0;
}

function getTakenSlots(date) {
  return db
    .prepare(
      `SELECT time FROM reservations WHERE date = ? AND status != 'cancelled'`
    )
    .all(date)
    .map((r) => r.time);
}

function createReservation({ lineUserId, date, time, menu, name, phone }) {
  const info = db
    .prepare(
      `INSERT INTO reservations (line_user_id, date, time, menu, name, phone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(lineUserId, date, time, menu, name, phone, new Date().toISOString());
  return db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(info.lastInsertRowid);
}

function listReservations() {
  return db
    .prepare(`SELECT * FROM reservations ORDER BY date ASC, time ASC, id ASC`)
    .all();
}

function getReservation(id) {
  return db.prepare(`SELECT * FROM reservations WHERE id = ?`).get(id);
}

function confirmReservation(id) {
  db.prepare(`UPDATE reservations SET status = 'confirmed' WHERE id = ?`).run(id);
  return getReservation(id);
}

module.exports = {
  db,
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
