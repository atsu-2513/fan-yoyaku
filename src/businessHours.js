// サロンの営業日・営業時間の設定。
// 実際の営業時間に合わせて調整してください。
// public/booking/app.js 側にも同じ設定を複製しているので、変更時は両方を更新すること。

const CLOSED_WEEKDAYS = [2]; // 0=日,1=月,2=火,... → 火曜定休
const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18]; // 各時刻ちょうどに1枠（最終受付18時、閉店19時想定）

const MENUS = [
  { id: 'cut', label: 'カット' },
  { id: 'color', label: 'カラー' },
  { id: 'perm', label: 'パーマ' },
];

function isBusinessDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return !CLOSED_WEEKDAYS.includes(d.getDay());
}

function slotsForDate(dateStr) {
  if (!isBusinessDay(dateStr)) return [];
  return SLOT_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`);
}

function isValidMenu(menuId) {
  return MENUS.some((m) => m.id === menuId);
}

function menuLabel(menuId) {
  const m = MENUS.find((m) => m.id === menuId);
  return m ? m.label : menuId;
}

module.exports = { CLOSED_WEEKDAYS, SLOT_HOURS, MENUS, isBusinessDay, slotsForDate, isValidMenu, menuLabel };
