const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const { expandRange } = require('./availability');

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
          `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS menus (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            price INTEGER,
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS staff_menu_settings (
            staff_id INTEGER NOT NULL,
            menu_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            price_override INTEGER,
            PRIMARY KEY (staff_id, menu_id)
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
      // 前日リマインド通知を二重送信しないための送信済みフラグ列
      const hasReminderSentAt = columns.rows.some((c) => c.name === 'reminder_sent_at');
      if (!hasReminderSentAt) {
        await client.execute(`ALTER TABLE reservations ADD COLUMN reminder_sent_at TEXT`);
      }
      // お客様からの「ご相談」欄と、それへのスタッフからの返信
      const hasConsultation = columns.rows.some((c) => c.name === 'consultation');
      if (!hasConsultation) {
        await client.execute(`ALTER TABLE reservations ADD COLUMN consultation TEXT`);
      }
      const hasReplyMessage = columns.rows.some((c) => c.name === 'reply_message');
      if (!hasReplyMessage) {
        await client.execute(`ALTER TABLE reservations ADD COLUMN reply_message TEXT`);
      }
      const hasReplySentAt = columns.rows.some((c) => c.name === 'reply_sent_at');
      if (!hasReplySentAt) {
        await client.execute(`ALTER TABLE reservations ADD COLUMN reply_sent_at TEXT`);
      }

      // スタッフのメール通知先アドレス
      const staffColumns = await client.execute(`PRAGMA table_info(staff)`);
      const hasEmail = staffColumns.rows.some((c) => c.name === 'email');
      if (!hasEmail) {
        await client.execute(`ALTER TABLE staff ADD COLUMN email TEXT`);
      }

      // メニューごとの施術時間(分)。既存メニューには60分をデフォルトで設定
      const menuColumns = await client.execute(`PRAGMA table_info(menus)`);
      const hasDuration = menuColumns.rows.some((c) => c.name === 'duration_minutes');
      if (!hasDuration) {
        await client.execute(`ALTER TABLE menus ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60`);
      }

      // 予約作成時点でのメニュー施術時間のスナップショット(あとでメニューの時間設定を変えても、
      // 過去の予約の空き枠計算がずれないように保持する)
      const hasReservationDuration = columns.rows.some((c) => c.name === 'duration_minutes');
      if (!hasReservationDuration) {
        await client.execute(`ALTER TABLE reservations ADD COLUMN duration_minutes INTEGER`);
      }

      // 定休日・営業時間のデフォルト値(未設定時のみ投入)
      const settingsResult = await client.execute(`SELECT key FROM settings`);
      const existingKeys = new Set(settingsResult.rows.map((r) => r.key));
      const defaultSettings = [
        ['closed_weekdays', JSON.stringify([2])],
        ['open_hour', '9'],
        ['close_hour', '21'],
      ];
      for (const [key, value] of defaultSettings) {
        if (!existingKeys.has(key)) {
          await client.execute({ sql: `INSERT INTO settings (key, value) VALUES (?, ?)`, args: [key, value] });
        }
      }

      // 共通メニューカタログのデフォルト値(まだ1件もなければ、これまでの固定メニューを投入)
      const menuCountResult = await client.execute(`SELECT COUNT(*) AS c FROM menus`);
      if (Number(menuCountResult.rows[0].c) === 0) {
        const defaultMenus = [
          { id: 'cut', label: 'カット', price: null, duration: 60, sort: 0 },
          { id: 'color', label: 'カラー', price: null, duration: 90, sort: 1 },
          { id: 'perm', label: 'パーマ', price: null, duration: 120, sort: 2 },
        ];
        for (const m of defaultMenus) {
          await client.execute({
            sql: `INSERT INTO menus (id, label, price, duration_minutes, active, sort_order, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
            args: [m.id, m.label, m.price, m.duration, m.sort, new Date().toISOString()],
          });
        }
      }

      // 30分刻みへの移行(初回のみ): これまでは「10:00を開放」＝1時間丸ごと空いている、という意味だったため、
      // 新しい30分刻みでも同じ意味になるよう、既存の「HH:00」開放枠には「HH:30」も開放済みとして補完する。
      const migratedFlag = await client.execute({
        sql: `SELECT value FROM settings WHERE key = ?`,
        args: ['migrated_half_hour_open_slots'],
      });
      if (migratedFlag.rows.length === 0) {
        const hourSlots = await client.execute(`SELECT staff_id, date, time FROM staff_open_slots WHERE time LIKE '%:00'`);
        for (const row of hourSlots.rows) {
          const hh = row.time.split(':')[0];
          await client.execute({
            sql: `INSERT OR IGNORE INTO staff_open_slots (staff_id, date, time, created_at) VALUES (?, ?, ?, ?)`,
            args: [row.staff_id, row.date, `${hh}:30`, new Date().toISOString()],
          });
        }
        await client.execute({
          sql: `INSERT INTO settings (key, value) VALUES ('migrated_half_hour_open_slots', '1')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          args: [],
        });
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
  const result = await client.execute(`SELECT id, name, username, active, email FROM staff ORDER BY id ASC`);
  return result.rows;
}

async function updateStaffPassword(id, passwordHash) {
  await ready();
  await client.execute({
    sql: `UPDATE staff SET password_hash = ? WHERE id = ?`,
    args: [passwordHash, id],
  });
}

async function updateStaffEmail(id, email) {
  await ready();
  await client.execute({
    sql: `UPDATE staff SET email = ? WHERE id = ?`,
    args: [email || null, id],
  });
  return getStaffById(id);
}

// ---------- 営業設定(定休日・営業時間) ----------

async function getSettings() {
  await ready();
  const result = await client.execute(`SELECT key, value FROM settings`);
  const map = {};
  for (const row of result.rows) map[row.key] = row.value;
  return {
    closedWeekdays: map.closed_weekdays ? JSON.parse(map.closed_weekdays) : [2],
    openHour: map.open_hour ? Number(map.open_hour) : 9,
    closeHour: map.close_hour ? Number(map.close_hour) : 21,
  };
}

async function updateSettings({ closedWeekdays, openHour, closeHour }) {
  await ready();
  const entries = [
    ['closed_weekdays', JSON.stringify(closedWeekdays)],
    ['open_hour', String(openHour)],
    ['close_hour', String(closeHour)],
  ];
  for (const [key, value] of entries) {
    await client.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [key, value],
    });
  }
  return getSettings();
}

// ---------- メニュー(共通カタログ + スタッフごとの調整) ----------

async function listMenus() {
  await ready();
  const result = await client.execute(`SELECT * FROM menus WHERE active = 1 ORDER BY sort_order ASC, id ASC`);
  return result.rows;
}

async function listAllMenusAdmin() {
  await ready();
  const result = await client.execute(`SELECT * FROM menus ORDER BY sort_order ASC, id ASC`);
  return result.rows;
}

async function getMenuById(id) {
  await ready();
  const result = await client.execute({ sql: `SELECT * FROM menus WHERE id = ?`, args: [id] });
  return result.rows[0] || null;
}

async function createMenu({ label, price, durationMinutes }) {
  await ready();
  const id = `menu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const maxSort = await client.execute(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM menus`);
  const sortOrder = Number(maxSort.rows[0].m) + 1;
  await client.execute({
    sql: `INSERT INTO menus (id, label, price, duration_minutes, active, sort_order, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    args: [id, label, price, durationMinutes || 60, sortOrder, new Date().toISOString()],
  });
  return getMenuById(id);
}

async function updateMenu(id, { label, price, durationMinutes, active }) {
  await ready();
  await client.execute({
    sql: `UPDATE menus SET label = ?, price = ?, duration_minutes = ?, active = ? WHERE id = ?`,
    args: [label, price, durationMinutes || 60, active ? 1 : 0, id],
  });
  return getMenuById(id);
}

async function getStaffMenuOverrides(staffId) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM staff_menu_settings WHERE staff_id = ?`,
    args: [staffId],
  });
  return result.rows;
}

async function setStaffMenuOverride(staffId, menuId, { enabled, priceOverride }) {
  await ready();
  await client.execute({
    sql: `INSERT INTO staff_menu_settings (staff_id, menu_id, enabled, price_override)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(staff_id, menu_id) DO UPDATE SET enabled = excluded.enabled, price_override = excluded.price_override`,
    args: [staffId, menuId, enabled ? 1 : 0, priceOverride === null || priceOverride === undefined ? null : priceOverride],
  });
}

// お客様の予約フォーム用: 指名したスタッフに実際に提供されるメニュー(価格込み)
async function listMenusForStaff(staffId) {
  await ready();
  const menus = await listMenus();
  const overrides = await getStaffMenuOverrides(staffId);
  const overrideMap = new Map(overrides.map((o) => [o.menu_id, o]));
  return menus
    .filter((m) => {
      const o = overrideMap.get(m.id);
      return !o || Number(o.enabled) !== 0;
    })
    .map((m) => {
      const o = overrideMap.get(m.id);
      const price = o && o.price_override !== null && o.price_override !== undefined ? o.price_override : m.price;
      return { id: m.id, label: m.label, price, durationMinutes: m.duration_minutes || 60 };
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

// sourceDate に自分が開放している時間を、指定した複数の日付(targetDates)すべてに
// まとめてコピーする（カレンダーから複数日をタップして選ぶ一括コピー機能）
async function copyOpenSlotsToDates(staffId, sourceDate, targetDates) {
  await ready();
  const times = await getOpenSlotsForStaff(staffId, sourceDate);
  let copied = 0;
  for (const date of targetDates) {
    for (const t of times) {
      await openSlot(staffId, date, t);
      copied++;
    }
  }
  return { sourceCount: times.length, copied };
}

// ---------- 予約 ----------

// そのスタッフ・その日に予約が入っている(施術時間ぶん)コマを、開始時刻だけでなく
// 30分刻みで展開したコマ一覧として返す(施術時間が複数コマにまたがる予約に対応するため)
async function getTakenSlots(staffId, date) {
  await ready();
  const result = await client.execute({
    sql: `SELECT time, duration_minutes FROM reservations
          WHERE staff_id = ? AND date = ? AND status != 'cancelled'`,
    args: [staffId, date],
  });
  const taken = new Set();
  for (const r of result.rows) {
    for (const t of expandRange(r.time, r.duration_minutes || 60)) taken.add(t);
  }
  return Array.from(taken);
}

async function createReservation({ lineUserId, staffId, date, time, menu, name, phone, consultation, durationMinutes }) {
  await ready();
  const insert = await client.execute({
    sql: `INSERT INTO reservations (line_user_id, staff_id, date, time, menu, name, phone, consultation, duration_minutes, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [lineUserId, staffId, date, time, menu, name, phone, consultation || null, durationMinutes || 60, new Date().toISOString()],
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

async function confirmReservation(id, replyMessage) {
  await ready();
  if (replyMessage) {
    await client.execute({
      sql: `UPDATE reservations SET status = 'confirmed', reply_message = ?, reply_sent_at = ? WHERE id = ?`,
      args: [replyMessage, new Date().toISOString(), id],
    });
  } else {
    await client.execute({
      sql: `UPDATE reservations SET status = 'confirmed' WHERE id = ?`,
      args: [id],
    });
  }
  return getReservation(id);
}

async function cancelReservation(id) {
  await ready();
  await client.execute({
    sql: `UPDATE reservations SET status = 'cancelled' WHERE id = ?`,
    args: [id],
  });
  return getReservation(id);
}

// LINEの「キャンセル」コマンド用: そのお客様の、今日以降のキャンセル可能な予約一覧
async function listUpcomingReservationsForUser(lineUserId, fromDate) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM reservations
          WHERE line_user_id = ? AND status IN ('pending', 'confirmed') AND date >= ?
          ORDER BY date ASC, time ASC, id ASC`,
    args: [lineUserId, fromDate],
  });
  return result.rows;
}

// 前日リマインド用: 指定日の確定済み予約のうち、まだリマインドを送っていないもの
async function listConfirmedReservationsForDate(date) {
  await ready();
  const result = await client.execute({
    sql: `SELECT * FROM reservations
          WHERE date = ? AND status = 'confirmed' AND (reminder_sent_at IS NULL OR reminder_sent_at = '')
          ORDER BY time ASC, id ASC`,
    args: [date],
  });
  return result.rows;
}

async function markReminderSent(id) {
  await ready();
  await client.execute({
    sql: `UPDATE reservations SET reminder_sent_at = ? WHERE id = ?`,
    args: [new Date().toISOString(), id],
  });
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
  updateStaffEmail,
  getSettings,
  updateSettings,
  listMenus,
  listAllMenusAdmin,
  getMenuById,
  createMenu,
  updateMenu,
  getStaffMenuOverrides,
  setStaffMenuOverride,
  listMenusForStaff,
  openSlot,
  closeSlot,
  getOpenSlotsForStaff,
  isSlotOpenForStaff,
  getTakenSlots,
  createReservation,
  listReservationsWithStaff,
  listReservationsForStaff,
  getReservation,
  confirmReservation,
  cancelReservation,
  listUpcomingReservationsForUser,
  listConfirmedReservationsForDate,
  markReminderSent,
  copyOpenSlotsToDates,
};
