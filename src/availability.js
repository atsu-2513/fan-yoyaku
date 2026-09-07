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

module.exports = {
  SLOT_INTERVAL_MINUTES,
  timeToMinutes,
  minutesToTime,
  expandRange,
  computeAvailableStartTimes,
};
