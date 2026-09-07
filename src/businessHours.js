// サロンの営業日・営業時間・メニューはオーナーが管理画面から変更できます(DB管理)。
// ここでは、DBの値をキャッシュしつつ扱いやすい形で提供します
// (予約ページ・スタッフ画面・管理画面はすべてこのファイル経由でDBの値を参照するため、
// 管理画面で変更すればどこにも複製なく反映されます)。

let cachedSettings = null;
let cachedMenus = null;

async function loadSettings() {
  if (!cachedSettings) {
    const { getSettings } = require('./db');
    cachedSettings = await getSettings();
  }
  return cachedSettings;
}

// 管理画面で定休日・営業時間を更新した直後に呼び出し、キャッシュを作り直す
function invalidateSettingsCache() {
  cachedSettings = null;
}

async function loadMenus() {
  if (!cachedMenus) {
    const { listAllMenusAdmin } = require('./db');
    cachedMenus = await listAllMenusAdmin();
  }
  return cachedMenus;
}

// 管理画面でメニューを追加・変更した直後に呼び出し、キャッシュを作り直す
function invalidateMenuCache() {
  cachedMenus = null;
}

async function getBusinessSettings() {
  return loadSettings();
}

async function getSlotHours() {
  const s = await loadSettings();
  const hours = [];
  for (let h = s.openHour; h < s.closeHour; h++) hours.push(h);
  return hours;
}

async function isBusinessDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const s = await loadSettings();
  return !s.closedWeekdays.includes(d.getDay());
}

async function slotsForDate(dateStr) {
  if (!(await isBusinessDay(dateStr))) return [];
  const hours = await getSlotHours();
  return hours.map((h) => `${String(h).padStart(2, '0')}:00`);
}

// メニューIDが(有効な)メニューとして存在するか。特定スタッフに提供されているかは
// db.js の listMenusForStaff() で別途確認すること。
async function isValidMenu(menuId) {
  const menus = await loadMenus();
  return menus.some((m) => m.id === menuId && Number(m.active) === 1);
}

// メニューIDから表示名を引く(カタログから消えていない限り、無効化後も履歴表示のため引ける)
async function menuLabel(menuId) {
  const menus = await loadMenus();
  const m = menus.find((mm) => mm.id === menuId);
  return m ? m.label : menuId;
}

// 日本時間(JST)基準の「今日」「明日」の日付文字列(YYYY-MM-DD)。
// サーバーはUTCで動いていることがあるため、前日リマインド等の日付判定はこちらを使う。
function todayJST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function tomorrowJST() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

module.exports = {
  getBusinessSettings,
  getSlotHours,
  isBusinessDay,
  slotsForDate,
  isValidMenu,
  menuLabel,
  invalidateSettingsCache,
  invalidateMenuCache,
  todayJST,
  tomorrowJST,
};
