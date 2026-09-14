// 30分刻みの時間枠と、メニューごとの施術時間(何コマ連続で必要か)を扱う純粋関数群。
// DBやHTTPには依存しないので、テストしやすいようにここへ切り出している。

const SLOT_INTERVAL_MINUTES = 30;

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// startTimeから durationMinutes分の施術に必要な、30分刻みのコマ一覧を返す
// (例: 10:00開始・120分 → ['10:00','10:30','11:00','11:30'])
function expandRange(startTime, durationMinutes) {
  const steps = Math.max(1, Math.ceil((Number(durationMinutes) || SLOT_INTERVAL_MINUTES) / SLOT_INTERVAL_MINUTES));
  const startMin = timeToMinutes(startTime);
  const result = [];
  for (let i = 0; i < steps; i++) {
    result.push(minutesToTime(startMin + i * SLOT_INTERVAL_MINUTES));
  }
  return result;
}

// 営業時間内の全コマ(candidateSlots)のうち、
// スタッフが開放していて(openSlots)、かつ既存の予約と重ならない(takenSlots)コマが
// durationMinutes分連続している「開始時刻」だけを返す
function computeAvailableStartTimes({ candidateSlots, openSlots, takenSlots, durationMinutes }) {
  const candidateSet = new Set(candidateSlots);
  const openSet = new Set(openSlots);
  const takenSet = new Set(takenSlots);
  return candidateSlots.filter((start) => {
    const needed = expandRange(start, durationMinutes);
    return needed.every((t) => candidateSet.has(t) && openSet.has(t) && !takenSet.has(t));
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Date型を、実行環境のタイムゾーンに関わらず「その日付が表すローカルの年月日」の
// YYYY-MM-DD文字列に変換する(toISOString()はUTCに変換してしまうため、サーバーの
// 実行タイムゾーンがUTC以外になった場合に日付がずれてしまう問題を避けるために使う)
function dateToStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 指定日を含む週の月曜日の日付を返す(週間グリッド表示用)
function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=日曜 ... 6=土曜
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return dateToStr(d);
}

// 指定日からn日後(負数でn日前)の日付を返す
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}

module.exports = {
  SLOT_INTERVAL_MINUTES,
  timeToMinutes,
  minutesToTime,
  expandRange,
  computeAvailableStartTimes,
  mondayOf,
  addDays,
};
