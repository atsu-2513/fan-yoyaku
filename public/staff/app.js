(function () {
  const state = {
    staff: null,
    viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: null,
    openSlots: [],
    copyMode: false,
    copyTargets: new Set(),
  };

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function toDateStr(y, m, d) {
    return `${y}-${pad2(m + 1)}-${pad2(d)}`;
  }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  async function init() {
    try {
      const res = await fetch('/staff/api/me');
      if (res.status === 401) {
        window.location.href = '/staff/login.html';
        return;
      }
      const data = await res.json();
      state.staff = data.staff;
      document.getElementById('staff-name').textContent = `hair salon FAN（${state.staff.name}さん）`;
      renderCalendar();
      loadReservations();
      initScheduleView();
      loadCustomers();
      loadCandidateRequests();
      loadWaitlistAlerts();
      loadShopOrders();
    } catch (err) {
      window.location.href = '/staff/login.html';
    }
  }

  document.getElementById('logout').addEventListener('click', async () => {
    await fetch('/staff/api/logout', { method: 'POST' });
    window.location.href = '/staff/login.html';
  });

  // ---------- 空き時間カレンダー ----------
  function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('month-label');
    const y = state.viewMonth.getFullYear();
    const m = state.viewMonth.getMonth();
    label.textContent = `${y}年${m + 1}月`;

    grid.innerHTML = '';
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = todayStr();

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'day-cell is-empty';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateStr(y, m, d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-cell';
      btn.textContent = String(d);
      btn.disabled = dateStr < today;
      if (dateStr === state.selectedDate) btn.classList.add('is-selected');
      if (state.copyMode && state.copyTargets.has(dateStr)) btn.classList.add('is-copy-target');
      btn.addEventListener('click', () => {
        if (state.copyMode) {
          toggleCopyTarget(dateStr);
        } else {
          selectDate(dateStr);
        }
      });
      grid.appendChild(btn);
    }
  }

  document.getElementById('prev-month').addEventListener('click', () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  // ---------- 週間グリッド表示(自分の1週間分の空き状況を一覧で見る) ----------
  let staffWeekStart = null;

  function mondayOfLocal(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDaysLocal(dateStr, n) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + n);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }

  document.getElementById('staff-view-toggle-calendar').addEventListener('click', () => {
    document.getElementById('staff-view-toggle-calendar').classList.add('is-active');
    document.getElementById('staff-view-toggle-week').classList.remove('is-active');
    document.getElementById('staff-calendar-view').hidden = false;
    document.getElementById('staff-week-view').hidden = true;
  });
  document.getElementById('staff-view-toggle-week').addEventListener('click', () => {
    document.getElementById('staff-view-toggle-week').classList.add('is-active');
    document.getElementById('staff-view-toggle-calendar').classList.remove('is-active');
    document.getElementById('staff-week-view').hidden = false;
    document.getElementById('staff-calendar-view').hidden = true;
    if (!staffWeekStart) staffWeekStart = mondayOfLocal(todayStr());
    loadStaffWeek();
  });
  document.getElementById('staff-prev-week').addEventListener('click', () => {
    staffWeekStart = addDaysLocal(staffWeekStart || mondayOfLocal(todayStr()), -7);
    loadStaffWeek();
  });
  document.getElementById('staff-next-week').addEventListener('click', () => {
    staffWeekStart = addDaysLocal(staffWeekStart || mondayOfLocal(todayStr()), 7);
    loadStaffWeek();
  });

  const WEEKDAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土'];

  async function loadStaffWeek() {
    const table = document.getElementById('staff-week-table');
    const label = document.getElementById('staff-week-label');
    if (!staffWeekStart) staffWeekStart = mondayOfLocal(todayStr());
    label.textContent = `${staffWeekStart} 〜`;
    table.innerHTML = '<tr><td class="week-grid__loading">読み込み中...</td></tr>';
    try {
      const res = await fetch(`/staff/api/slots-week?date=${encodeURIComponent(staffWeekStart)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        table.innerHTML = '<tr><td class="week-grid__loading">読み込みに失敗しました。</td></tr>';
        return;
      }
      renderStaffWeekGrid(data);
    } catch (err) {
      table.innerHTML = '<tr><td class="week-grid__loading">読み込みに失敗しました。</td></tr>';
    }
  }

  function renderStaffWeekGrid(data) {
    const table = document.getElementById('staff-week-table');
    if (data.weekStart) {
      staffWeekStart = data.weekStart;
      document.getElementById('staff-week-label').textContent = `${data.weekStart} 〜`;
    }
    table.innerHTML = '';
    if (!data.slotTimes || data.slotTimes.length === 0) {
      table.innerHTML = '<tr><td class="week-grid__loading">この週は表示できる時間帯がありません。</td></tr>';
      return;
    }
    const today = todayStr();

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    data.days.forEach((day) => {
      const th = document.createElement('th');
      const d = new Date(`${day.date}T00:00:00`);
      th.innerHTML = `${d.getMonth() + 1}/${d.getDate()}<br>${WEEKDAY_LABELS_JA[d.getDay()]}`;
      if (day.date === today) th.classList.add('week-grid__today');
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    data.slotTimes.forEach((time) => {
      const tr = document.createElement('tr');
      const timeTh = document.createElement('th');
      timeTh.scope = 'row';
      timeTh.textContent = time;
      tr.appendChild(timeTh);

      data.days.forEach((day) => {
        const td = document.createElement('td');
        if (!day.businessDay) {
          td.className = 'week-grid__cell--closed';
          td.textContent = '×';
        } else if ((day.takenSlots || []).includes(time)) {
          td.className = 'week-grid__cell--taken';
          td.textContent = '●';
        } else if ((day.openSlots || []).includes(time)) {
          td.className = 'week-grid__cell--open';
          td.textContent = '○';
        } else {
          td.className = 'week-grid__cell--unopened';
          td.textContent = '−';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  async function selectDate(dateStr) {
    state.selectedDate = dateStr;
    exitCopyMode();
    renderCalendar();

    const section = document.getElementById('slot-section');
    const label = document.getElementById('selected-date-label');
    const grid = document.getElementById('slot-grid');
    const copyToggle = document.getElementById('copy-mode-toggle');
    section.hidden = false;
    label.textContent = `${dateStr} の空き時間`;
    grid.innerHTML = '<p class="slot-hint">読み込み中...</p>';

    try {
      const res = await fetch(`/staff/api/slots?date=${encodeURIComponent(dateStr)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        grid.innerHTML = '<p class="slot-hint">読み込みに失敗しました。</p>';
        copyToggle.hidden = true;
        return;
      }
      if (!data.businessDay) {
        grid.innerHTML = '<p class="slot-hint">この日は定休日のため設定できません。</p>';
        copyToggle.hidden = true;
        return;
      }
      renderSlotGrid(dateStr, data.candidateSlots, data.openSlots);
      copyToggle.hidden = false;
    } catch (err) {
      grid.innerHTML = '<p class="slot-hint">読み込みに失敗しました。</p>';
    }
  }

  // ---------- 他の日への一括コピー ----------
  document.getElementById('copy-mode-toggle').addEventListener('click', () => {
    if (!state.selectedDate) return;
    state.copyMode = true;
    state.copyTargets.clear();
    document.getElementById('copy-mode-toggle').hidden = true;
    document.getElementById('copy-targets-panel').hidden = false;
    document.getElementById('copy-message').hidden = true;
    renderCopyTargetsList();
    renderCalendar();
  });

  document.getElementById('copy-cancel').addEventListener('click', () => {
    exitCopyMode();
    renderCalendar();
  });

  function exitCopyMode() {
    state.copyMode = false;
    state.copyTargets.clear();
    document.getElementById('copy-mode-toggle').hidden = false;
    document.getElementById('copy-targets-panel').hidden = true;
  }

  function toggleCopyTarget(dateStr) {
    if (dateStr === state.selectedDate) return; // コピー元の日は対象にできない
    if (state.copyTargets.has(dateStr)) {
      state.copyTargets.delete(dateStr);
    } else {
      state.copyTargets.add(dateStr);
    }
    renderCalendar();
    renderCopyTargetsList();
  }

  function renderCopyTargetsList() {
    const list = document.getElementById('copy-targets-list');
    const execBtn = document.getElementById('copy-execute');
    const targets = Array.from(state.copyTargets).sort();
    if (targets.length === 0) {
      list.innerHTML = '<p class="slot-hint">まだ選択されていません。</p>';
    } else {
      list.innerHTML = '';
      targets.forEach((d) => {
        const chip = document.createElement('span');
        chip.className = 'copy-target-chip';
        chip.textContent = d;
        list.appendChild(chip);
      });
    }
    execBtn.disabled = targets.length === 0;
  }

  document.getElementById('copy-execute').addEventListener('click', async () => {
    const btn = document.getElementById('copy-execute');
    const msg = document.getElementById('copy-message');
    const targetDates = Array.from(state.copyTargets);
    if (!state.selectedDate || targetDates.length === 0) return;

    btn.disabled = true;
    msg.hidden = true;
    try {
      const res = await fetch('/staff/api/slots/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDate: state.selectedDate, targetDates }),
      });
      const data = await res.json();
      msg.hidden = false;
      if (!res.ok || !data.ok) {
        msg.className = 'message message--error';
        msg.textContent = 'コピーに失敗しました。';
      } else if (data.copied === 0) {
        msg.className = 'message message--error';
        msg.textContent = 'コピーできる開放済みの時間がありません。';
      } else {
        const skippedNote = data.skipped ? `（定休日のため${data.skipped}件はスキップしました）` : '';
        msg.className = 'message message--success';
        msg.textContent = `${targetDates.length - data.skipped}日に、合計${data.copied}件の空き時間をコピーしました。${skippedNote}`;
        state.copyTargets.clear();
        renderCopyTargetsList();
        renderCalendar();
      }
    } catch (err) {
      msg.hidden = false;
      msg.className = 'message message--error';
      msg.textContent = '通信エラーが発生しました。';
    } finally {
      btn.disabled = false;
    }
  });

  function renderSlotGrid(dateStr, candidateSlots, openSlots) {
    const grid = document.getElementById('slot-grid');
    grid.innerHTML = '';
    const open = new Set(openSlots);
    candidateSlots.forEach((time) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-toggle' + (open.has(time) ? ' is-open' : '');
      btn.textContent = time;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch('/staff/api/slots/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateStr, time }),
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            btn.classList.toggle('is-open', data.open);
          }
        } finally {
          btn.disabled = false;
        }
      });
      grid.appendChild(btn);
    });
  }

  // ---------- 自分の予約一覧 ----------
  let lastReservations = [];
  async function loadReservations() {
    const tbody = document.getElementById('reservations-body');
    const emptyMessage = document.getElementById('empty-message');
    tbody.innerHTML = '';
    try {
      const res = await fetch('/staff/api/reservations');
      const data = await res.json();
      const reservations = data.reservations || [];
      lastReservations = reservations;
      emptyMessage.hidden = reservations.length > 0;
      reservations.forEach((r) => tbody.appendChild(renderRow(r)));
      renderSchedule();
    } catch (err) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = '読み込みに失敗しました。';
    }
  }

  function renderRow(r) {
    const tr = document.createElement('tr');

    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge--${r.status}`;
    badge.textContent = r.status === 'confirmed' ? '確定' : r.status === 'cancelled' ? 'キャンセル' : '仮予約';
    statusTd.appendChild(badge);

    const dateTd = document.createElement('td');
    dateTd.textContent = `${r.date} ${r.time}`;

    const menuTd = document.createElement('td');
    menuTd.textContent = r.menuLabel;

    const consultTd = document.createElement('td');
    consultTd.style.minWidth = '180px';
    let replyInput = null;
    if (r.consultation) {
      const p = document.createElement('div');
      p.textContent = r.consultation;
      p.style.whiteSpace = 'pre-wrap';
      p.style.marginBottom = '4px';
      p.style.fontSize = '12px';
      consultTd.appendChild(p);
      if (r.status === 'pending') {
        replyInput = document.createElement('textarea');
        replyInput.className = 'reply-input';
        replyInput.rows = 2;
        replyInput.placeholder = '返信（確定時にLINEで届きます・任意）';
        replyInput.value = r.reply_message || '';
        consultTd.appendChild(replyInput);
      } else if (r.reply_message) {
        const rp = document.createElement('div');
        rp.className = 'reply-sent';
        rp.textContent = `返信: ${r.reply_message}`;
        consultTd.appendChild(rp);
      }
    } else {
      consultTd.textContent = '—';
    }

    const nameTd = document.createElement('td');
    nameTd.textContent = r.name;

    const phoneTd = document.createElement('td');
    phoneTd.textContent = r.phone;

    const actionTd = document.createElement('td');
    let rescheduleBtn = null;
    if (r.status === 'cancelled') {
      actionTd.textContent = '—';
    } else {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.gap = '6px';
      wrap.style.flexWrap = 'wrap';
      if (r.status !== 'confirmed') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn';
        confirmBtn.textContent = '確定する';
        confirmBtn.addEventListener('click', () =>
          confirmReservation(r.id, confirmBtn, replyInput ? replyInput.value : '')
        );
        wrap.appendChild(confirmBtn);
      }
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn--ghost';
      cancelBtn.textContent = 'キャンセル';
      cancelBtn.addEventListener('click', () => cancelReservationAction(r.id, cancelBtn));
      wrap.appendChild(cancelBtn);
      rescheduleBtn = document.createElement('button');
      rescheduleBtn.className = 'btn btn--ghost';
      rescheduleBtn.textContent = '日時を変更する';
      wrap.appendChild(rescheduleBtn);
      actionTd.appendChild(wrap);
    }

    tr.append(statusTd, dateTd, menuTd, consultTd, nameTd, phoneTd, actionTd);

    const rescheduleTr = document.createElement('tr');
    rescheduleTr.hidden = true;
    const rescheduleTd = document.createElement('td');
    rescheduleTd.colSpan = 7;
    rescheduleTd.className = 'history-cell';
    rescheduleTr.appendChild(rescheduleTd);
    if (rescheduleBtn) {
      rescheduleBtn.addEventListener('click', () => {
        rescheduleTr.hidden = !rescheduleTr.hidden;
        if (!rescheduleTr.hidden && !rescheduleTd.dataset.built) {
          buildReschedulePanel(r, rescheduleTd, rescheduleTr);
          rescheduleTd.dataset.built = '1';
        }
      });
    }

    const frag = document.createDocumentFragment();
    frag.append(tr, rescheduleTr);
    return frag;
  }

  // ---------- 予約日時の変更(画面上でそのまま変更する) ----------
  function buildReschedulePanel(r, td, tr) {
    td.innerHTML = '';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = r.date;
    dateInput.style.marginRight = '8px';

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'btn btn--ghost';
    checkBtn.textContent = '空き時間を見る';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'やめる';
    cancelBtn.style.marginLeft = '8px';
    cancelBtn.addEventListener('click', () => {
      tr.hidden = true;
    });

    const slotsWrap = document.createElement('div');
    slotsWrap.style.display = 'flex';
    slotsWrap.style.flexWrap = 'wrap';
    slotsWrap.style.gap = '6px';
    slotsWrap.style.marginTop = '10px';

    const msg = document.createElement('p');
    msg.className = 'message';
    msg.hidden = true;
    msg.style.marginTop = '8px';

    checkBtn.addEventListener('click', async () => {
      const date = dateInput.value;
      if (!date) return;
      slotsWrap.textContent = '読み込み中...';
      try {
        const res = await fetch(
          `/staff/api/availability?date=${encodeURIComponent(date)}&reservationId=${encodeURIComponent(r.id)}`
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          slotsWrap.textContent = '取得に失敗しました。';
          return;
        }
        if (!data.businessDay) {
          slotsWrap.textContent = 'この日は定休日です。';
          return;
        }
        if (!data.slots.length) {
          slotsWrap.textContent = 'この日は空きがありません。';
          return;
        }
        slotsWrap.innerHTML = '';
        data.slots.forEach((time) => {
          const slotBtn = document.createElement('button');
          slotBtn.type = 'button';
          slotBtn.className = 'btn btn--ghost';
          slotBtn.textContent = time;
          slotBtn.addEventListener('click', () => doReschedule(r.id, date, time, msg, slotBtn));
          slotsWrap.appendChild(slotBtn);
        });
      } catch (err) {
        slotsWrap.textContent = '通信エラーが発生しました。';
      }
    });

    td.append(dateInput, checkBtn, cancelBtn, slotsWrap, msg);
  }

  async function doReschedule(id, date, time, msg, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/reservations/${id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        msg.textContent = data.error === 'slot_taken' ? 'その時間はすでに埋まっています。' : '変更に失敗しました。';
        msg.className = 'message message--error';
        msg.hidden = false;
        btn.disabled = false;
        return;
      }
      loadReservations();
      loadWaitlistAlerts();
    } catch (err) {
      msg.textContent = '通信エラーが発生しました。';
      msg.className = 'message message--error';
      msg.hidden = false;
      btn.disabled = false;
    }
  }

  async function cancelReservationAction(id, btn) {
    if (!window.confirm('このご予約をキャンセルしますか？お客様にLINEで通知が送信されます。')) return;
    btn.disabled = true;
    btn.textContent = '処理中...';
    try {
      const res = await fetch(`/staff/api/reservations/${id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('キャンセル処理に失敗しました。');
        btn.disabled = false;
        btn.textContent = 'キャンセル';
        return;
      }
      loadReservations();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
      btn.textContent = 'キャンセル';
    }
  }

  async function confirmReservation(id, btn, reply) {
    btn.disabled = true;
    btn.textContent = '送信中...';
    try {
      const res = await fetch(`/staff/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: reply || '' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('確定処理に失敗しました。');
        btn.disabled = false;
        btn.textContent = '確定する';
        return;
      }
      loadReservations();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
      btn.textContent = '確定する';
    }
  }

  // ---------- 予約のスケジュール表示(自分の予約のみ・時間帯グリッド) ----------
  let scheduleDate = (() => {
    const now = new Date();
    return toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  })();
  let scheduleSettings = null;

  function scheduleViewVisible() {
    const view = document.getElementById('reservations-schedule-view');
    return view && !view.hidden;
  }

  async function ensureScheduleSettings() {
    if (!scheduleSettings) {
      try {
        const res = await fetch('/staff/api/settings');
        const data = await res.json();
        scheduleSettings = data.settings || { openHour: 9, closeHour: 21, closedWeekdays: [] };
      } catch (err) {
        scheduleSettings = { openHour: 9, closeHour: 21, closedWeekdays: [] };
      }
    }
  }

  function scheduleSlotTimes() {
    const s = scheduleSettings || { openHour: 9, closeHour: 21 };
    // 早朝枠(オーナーによる予約移動専用)が設定されていれば、その時刻からグリッドを表示する
    // (早朝に移動された予約がグリッドから消えてしまわないようにするため)
    const startHour = s.earlyOpenHour != null && s.earlyOpenHour < s.openHour ? s.earlyOpenHour : s.openHour;
    const times = [];
    for (let mins = startHour * 60; mins < s.closeHour * 60; mins += 30) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      times.push(`${pad2(h)}:${pad2(m)}`);
    }
    return times;
  }

  async function renderSchedule() {
    if (!scheduleViewVisible()) return;
    await ensureScheduleSettings();
    const wrap = document.getElementById('schedule-grid-wrap');
    const summary = document.getElementById('schedule-summary');
    const dateInput = document.getElementById('schedule-date');
    if (dateInput.value !== scheduleDate) dateInput.value = scheduleDate;

    const d = new Date(`${scheduleDate}T00:00:00`);
    const isClosed = (scheduleSettings.closedWeekdays || []).includes(d.getDay());

    const dayReservations = lastReservations.filter((r) => r.date === scheduleDate && r.status !== 'cancelled');
    summary.textContent = `本日の予約: ${dayReservations.length}件`;

    if (isClosed) {
      wrap.innerHTML = '<p class="schedule-grid__empty-note">この日は定休日です。</p>';
      return;
    }

    const times = scheduleSlotTimes();
    if (!times.length) {
      wrap.innerHTML = '<p class="schedule-grid__empty-note">営業時間が設定されていません。</p>';
      return;
    }

    const blocksByIndex = new Map();
    dayReservations.forEach((r) => {
      const startIdx = times.indexOf(r.time);
      if (startIdx === -1) return; // 営業時間外の予約データは(通常ないが)スキップ
      const duration = r.durationMinutes || 60;
      const span = Math.max(1, Math.ceil(duration / 30));
      blocksByIndex.set(startIdx, { r, span });
    });

    const table = document.createElement('table');
    table.className = 'schedule-grid';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    const nameTh = document.createElement('th');
    nameTh.textContent = state.staff ? state.staff.name : '本日の予定';
    headRow.appendChild(nameTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbodyEl = document.createElement('tbody');
    let skipUntil = -1;
    times.forEach((time, rowIdx) => {
      const tr = document.createElement('tr');
      const timeTd = document.createElement('td');
      timeTd.className = 'schedule-grid__time';
      timeTd.textContent = time;
      tr.appendChild(timeTd);

      if (rowIdx >= skipUntil) {
        const block = blocksByIndex.get(rowIdx);
        const td = document.createElement('td');
        if (block) {
          const span = Math.min(block.span, times.length - rowIdx);
          td.rowSpan = span;
          skipUntil = rowIdx + span;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `schedule-block schedule-block--${block.r.status}`;
          const timeLabel = document.createElement('span');
          timeLabel.className = 'schedule-block__time';
          timeLabel.textContent = block.r.time;
          const nameLabel = document.createElement('span');
          nameLabel.className = 'schedule-block__name';
          nameLabel.textContent = `${block.r.name} / ${block.r.menuLabel}`;
          btn.append(timeLabel, nameLabel);
          btn.addEventListener('click', () => openScheduleModal(block.r));
          td.appendChild(btn);
        }
        tr.appendChild(td);
      }

      tbodyEl.appendChild(tr);
    });
    table.appendChild(tbodyEl);

    wrap.innerHTML = '';
    const scroll = document.createElement('div');
    scroll.className = 'schedule-grid-scroll';
    scroll.appendChild(table);
    wrap.appendChild(scroll);
  }

  // ---------- スケジュールのブロックをクリックした時の詳細・編集ポップアップ ----------
  function closeScheduleModal() {
    document.getElementById('schedule-modal-overlay').hidden = true;
    document.getElementById('schedule-modal-box').innerHTML = '';
  }

  function openScheduleModal(r) {
    const overlay = document.getElementById('schedule-modal-overlay');
    const box = document.getElementById('schedule-modal-box');
    box.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = `${r.date} ${r.time}〜`;
    box.appendChild(title);

    const badge = document.createElement('span');
    badge.className = `badge badge--${r.status}`;
    badge.textContent = r.status === 'confirmed' ? '確定' : r.status === 'cancelled' ? 'キャンセル' : '仮予約';
    box.appendChild(badge);

    [
      ['メニュー', r.menuLabel],
      ['お名前', r.name],
      ['電話番号', r.phone],
    ].forEach(([label, value]) => {
      const p = document.createElement('p');
      p.className = 'modal-box__row';
      p.textContent = `${label}: ${value}`;
      box.appendChild(p);
    });

    let replyInput = null;
    if (r.consultation) {
      const p = document.createElement('p');
      p.className = 'modal-box__row';
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = `ご相談: ${r.consultation}`;
      box.appendChild(p);
      if (r.status === 'pending') {
        replyInput = document.createElement('textarea');
        replyInput.className = 'reply-input';
        replyInput.rows = 2;
        replyInput.placeholder = '返信（確定時にLINEで届きます・任意）';
        replyInput.value = r.reply_message || '';
        box.appendChild(replyInput);
      } else if (r.reply_message) {
        const rp = document.createElement('p');
        rp.className = 'modal-box__row reply-sent';
        rp.textContent = `返信: ${r.reply_message}`;
        box.appendChild(rp);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'modal-box__actions';

    if (r.status !== 'cancelled') {
      if (r.status !== 'confirmed') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn';
        confirmBtn.textContent = '確定する';
        confirmBtn.addEventListener('click', async () => {
          await confirmReservation(r.id, confirmBtn, replyInput ? replyInput.value : '');
          closeScheduleModal();
        });
        actions.appendChild(confirmBtn);
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn--ghost';
      cancelBtn.textContent = 'キャンセル';
      cancelBtn.addEventListener('click', async () => {
        await cancelReservationAction(r.id, cancelBtn);
        closeScheduleModal();
      });
      actions.appendChild(cancelBtn);

      const rescheduleBtn = document.createElement('button');
      rescheduleBtn.className = 'btn btn--ghost';
      rescheduleBtn.textContent = '日時を変更する';
      const reschedulePanel = document.createElement('div');
      reschedulePanel.hidden = true;
      reschedulePanel.style.marginTop = '10px';
      reschedulePanel.style.width = '100%';
      rescheduleBtn.addEventListener('click', () => {
        reschedulePanel.hidden = !reschedulePanel.hidden;
        if (!reschedulePanel.hidden && !reschedulePanel.dataset.built) {
          buildReschedulePanel(r, reschedulePanel, {
            set hidden(v) {
              if (v) reschedulePanel.hidden = true;
            },
          });
          reschedulePanel.dataset.built = '1';
        }
      });
      actions.appendChild(rescheduleBtn);
      box.appendChild(actions);
      box.appendChild(reschedulePanel);
    } else {
      box.appendChild(actions);
    }

    const closeWrap = document.createElement('div');
    closeWrap.className = 'modal-box__close';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--ghost';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', closeScheduleModal);
    closeWrap.appendChild(closeBtn);
    box.appendChild(closeWrap);

    overlay.hidden = false;
  }

  function initScheduleView() {
    const listBtn = document.getElementById('reservations-view-list');
    const scheduleBtn = document.getElementById('reservations-view-schedule');
    const listView = document.getElementById('reservations-list-view');
    const scheduleViewEl = document.getElementById('reservations-schedule-view');
    const dateInput = document.getElementById('schedule-date');
    dateInput.value = scheduleDate;

    listBtn.addEventListener('click', () => {
      listBtn.classList.add('is-active');
      scheduleBtn.classList.remove('is-active');
      listView.hidden = false;
      scheduleViewEl.hidden = true;
    });
    scheduleBtn.addEventListener('click', () => {
      scheduleBtn.classList.add('is-active');
      listBtn.classList.remove('is-active');
      listView.hidden = true;
      scheduleViewEl.hidden = false;
      renderSchedule();
    });

    dateInput.addEventListener('change', () => {
      if (dateInput.value) {
        scheduleDate = dateInput.value;
        renderSchedule();
      }
    });
    document.getElementById('schedule-prev-day').addEventListener('click', () => {
      scheduleDate = addDaysLocal(scheduleDate, -1);
      renderSchedule();
    });
    document.getElementById('schedule-next-day').addEventListener('click', () => {
      scheduleDate = addDaysLocal(scheduleDate, 1);
      renderSchedule();
    });
    document.getElementById('schedule-today').addEventListener('click', () => {
      const now = new Date();
      scheduleDate = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
      renderSchedule();
    });

    document.getElementById('schedule-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeScheduleModal();
    });
  }

  // ---------- 候補日リクエスト(お客様が複数の希望日時を提示し、こちらで1つ確定する) ----------
  async function loadCandidateRequests() {
    const wrap = document.getElementById('candidate-requests-list');
    const empty = document.getElementById('candidate-requests-empty');
    wrap.innerHTML = '';
    try {
      const res = await fetch('/staff/api/candidate-requests');
      const data = await res.json();
      const requests = (data.requests || []).filter((r) => r.status === 'pending');
      empty.hidden = requests.length > 0;
      requests.forEach((r) => wrap.appendChild(renderCandidateRequestCard(r)));
    } catch (err) {
      empty.hidden = false;
      empty.textContent = '読み込みに失敗しました。';
    }
  }

  function renderCandidateRequestCard(r) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${r.name}様</strong>（${r.phone}）`;
    card.appendChild(title);

    if (r.consultation) {
      const c = document.createElement('div');
      c.textContent = `ご相談: ${r.consultation}`;
      c.style.fontSize = '12px';
      c.style.whiteSpace = 'pre-wrap';
      c.style.marginTop = '4px';
      card.appendChild(c);
    }

    const datesWrap = document.createElement('div');
    datesWrap.style.display = 'flex';
    datesWrap.style.flexWrap = 'wrap';
    datesWrap.style.gap = '8px';
    datesWrap.style.marginTop = '10px';
    (r.dates || []).forEach((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = `第${d.rank}希望: ${d.date} ${d.time} で確定`;
      btn.addEventListener('click', () => confirmCandidateRequestAction(r.id, d.rank, btn));
      datesWrap.appendChild(btn);
    });
    card.appendChild(datesWrap);

    const declineBtn = document.createElement('button');
    declineBtn.type = 'button';
    declineBtn.className = 'btn btn--ghost';
    declineBtn.textContent = 'どの候補日も難しい(見送る)';
    declineBtn.style.marginTop = '8px';
    declineBtn.addEventListener('click', () => declineCandidateRequestAction(r.id, declineBtn));
    card.appendChild(declineBtn);

    return card;
  }

  async function confirmCandidateRequestAction(id, rank, btn) {
    if (!window.confirm('この日時で確定しますか？お客様にLINEで通知が送信されます。')) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/candidate-requests/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rank }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error === 'slot_taken' ? 'その時間はすでに埋まっています。' : '確定に失敗しました。');
        btn.disabled = false;
        return;
      }
      loadCandidateRequests();
      loadReservations();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
    }
  }

  async function declineCandidateRequestAction(id, btn) {
    if (!window.confirm('どの候補日も難しい旨をお客様にお伝えして見送りますか？')) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/candidate-requests/${id}/decline`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('処理に失敗しました。');
        btn.disabled = false;
        return;
      }
      loadCandidateRequests();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
    }
  }

  // ---------- 空き通知(キャンセルで第一希望が空いた場合の通知・お声がけ) ----------
  async function loadWaitlistAlerts() {
    const wrap = document.getElementById('waitlist-alerts-list');
    const empty = document.getElementById('waitlist-alerts-empty');
    wrap.innerHTML = '';
    try {
      const res = await fetch('/staff/api/waitlist-alerts');
      const data = await res.json();
      const alerts = data.alerts || [];
      empty.hidden = alerts.length > 0;
      alerts.forEach((a) => wrap.appendChild(renderWaitlistAlertCard(a)));
    } catch (err) {
      empty.hidden = false;
      empty.textContent = '読み込みに失敗しました。';
    }
  }

  function renderWaitlistAlertCard(a) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${a.date} ${a.time}</strong> に空きが出ました（${a.name}様の第一希望）`;
    card.appendChild(title);

    const textarea = document.createElement('textarea');
    textarea.className = 'reply-input';
    textarea.rows = 3;
    textarea.style.marginTop = '8px';
    textarea.style.width = '100%';
    textarea.placeholder = 'お客様に送るメッセージ(空欄なら定型文を送信します)';
    card.appendChild(textarea);

    const btnWrap = document.createElement('div');
    btnWrap.style.display = 'flex';
    btnWrap.style.gap = '8px';
    btnWrap.style.marginTop = '8px';

    const notifyBtn = document.createElement('button');
    notifyBtn.type = 'button';
    notifyBtn.className = 'btn';
    notifyBtn.textContent = 'このメッセージをLINEで送る';
    notifyBtn.addEventListener('click', () => notifyWaitlistAlertAction(a.id, textarea.value, notifyBtn));

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn--ghost';
    dismissBtn.textContent = '対応しない(非表示にする)';
    dismissBtn.addEventListener('click', () => dismissWaitlistAlertAction(a.id, dismissBtn));

    btnWrap.append(notifyBtn, dismissBtn);
    card.appendChild(btnWrap);

    return card;
  }

  async function notifyWaitlistAlertAction(id, message, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/waitlist-alerts/${id}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('送信に失敗しました。');
        btn.disabled = false;
        return;
      }
      loadWaitlistAlerts();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
    }
  }

  async function dismissWaitlistAlertAction(id, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/waitlist-alerts/${id}/dismiss`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('処理に失敗しました。');
        btn.disabled = false;
        return;
      }
      loadWaitlistAlerts();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
    }
  }

  // ---------- 顧客管理 ----------
  async function loadCustomers() {
    const tbody = document.getElementById('customers-body');
    const emptyMessage = document.getElementById('customers-empty-message');
    tbody.innerHTML = '';
    try {
      const res = await fetch('/staff/api/customers');
      const data = await res.json();
      const customers = data.customers || [];
      emptyMessage.hidden = customers.length > 0;
      customers.forEach((c) => tbody.appendChild(renderCustomerRow(c)));
    } catch (err) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = '読み込みに失敗しました。';
    }
  }

  function renderCustomerRow(c) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = c.name;
    nameInput.maxLength = 100;
    nameInput.style.width = '100%';
    nameInput.style.fontSize = '13px';
    nameTd.appendChild(nameInput);

    const phoneTd = document.createElement('td');
    phoneTd.textContent = c.phone;

    const countTd = document.createElement('td');
    countTd.textContent = c.visit_count || 0;

    const lastVisitTd = document.createElement('td');
    lastVisitTd.textContent = c.last_visit_date || '—';

    const memoTd = document.createElement('td');
    memoTd.style.minWidth = '160px';
    const memoInput = document.createElement('textarea');
    memoInput.className = 'reply-input';
    memoInput.rows = 2;
    memoInput.maxLength = 1000;
    memoInput.placeholder = 'アレルギー・ご要望などのメモ（任意）';
    memoInput.value = c.memo || '';
    memoTd.appendChild(memoInput);

    const actionTd = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--ghost';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => saveCustomer(c.id, nameInput.value, memoInput.value, saveBtn));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn--ghost';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteCustomerAction(c.id, deleteBtn));
    const historyBtn = document.createElement('button');
    historyBtn.className = 'btn btn--ghost';
    historyBtn.textContent = '履歴を見る';
    const messageBtn = document.createElement('button');
    messageBtn.className = 'btn btn--ghost';
    messageBtn.textContent = 'メッセージを送る';
    wrap.append(saveBtn, deleteBtn, historyBtn, messageBtn);
    actionTd.appendChild(wrap);

    tr.append(nameTd, phoneTd, countTd, lastVisitTd, memoTd, actionTd);

    const historyTr = document.createElement('tr');
    historyTr.hidden = true;
    const historyTd = document.createElement('td');
    historyTd.colSpan = 6;
    historyTd.className = 'history-cell';
    historyTr.appendChild(historyTd);
    historyBtn.addEventListener('click', () => toggleCustomerHistory(c.id, historyTr, historyTd, historyBtn));

    const messageTr = document.createElement('tr');
    messageTr.hidden = true;
    const messageTd = document.createElement('td');
    messageTd.colSpan = 6;
    messageTd.className = 'history-cell';
    messageTr.appendChild(messageTd);
    messageBtn.addEventListener('click', () => {
      messageTr.hidden = !messageTr.hidden;
      if (!messageTr.hidden && !messageTd.dataset.built) {
        buildCustomerMessagePanel(c, messageTd, `/staff/api/customers/${c.id}/message`);
        messageTd.dataset.built = '1';
      }
    });

    const frag = document.createDocumentFragment();
    frag.append(tr, historyTr, messageTr);
    return frag;
  }

  async function toggleCustomerHistory(id, historyTr, historyTd, btn) {
    if (!historyTr.hidden) {
      historyTr.hidden = true;
      btn.textContent = '履歴を見る';
      return;
    }
    historyTr.hidden = false;
    btn.textContent = '閉じる';
    btn.disabled = true;
    historyTd.innerHTML = '<p class="slot-hint">読み込み中...</p>';
    try {
      const res = await fetch(`/staff/api/customers/${id}/history`);
      const data = await res.json();
      const history = data.history || [];
      if (!res.ok || !data.ok) {
        historyTd.innerHTML = '<p class="slot-hint">読み込みに失敗しました。</p>';
      } else if (!history.length) {
        historyTd.innerHTML = '<p class="slot-hint">来店履歴はまだありません。</p>';
      } else {
        const table = document.createElement('table');
        table.className = 'table';
        table.innerHTML = '<thead><tr><th>日時</th><th>メニュー</th><th>状態</th></tr></thead>';
        const historyBody = document.createElement('tbody');
        history.forEach((h) => {
          const row = document.createElement('tr');
          const dateTd = document.createElement('td');
          dateTd.textContent = `${h.date} ${h.time}`;
          const menuTd = document.createElement('td');
          menuTd.textContent = h.menuLabel;
          const statusTd = document.createElement('td');
          const badge = document.createElement('span');
          badge.className = `badge badge--${h.status}`;
          badge.textContent = h.status === 'confirmed' ? '確定' : '仮予約';
          statusTd.appendChild(badge);
          row.append(dateTd, menuTd, statusTd);
          historyBody.appendChild(row);
        });
        table.appendChild(historyBody);
        historyTd.innerHTML = '';
        historyTd.appendChild(table);
      }
    } catch (err) {
      historyTd.innerHTML = '<p class="slot-hint">通信エラーが発生しました。</p>';
    } finally {
      btn.disabled = false;
    }
  }

  // お客様に任意のタイミングでLINEメッセージを送るためのパネル(履歴パネルと同じ折りたたみ行に表示)
  // endpoint は '/staff/api/customers/:id/message' のように、送信先のAPIパスを渡す
  function buildCustomerMessagePanel(c, td, endpoint) {
    td.innerHTML = '';
    const label = document.createElement('p');
    label.className = 'slot-hint';
    label.textContent = `${c.name}様にLINEでメッセージを送ります。`;
    const textarea = document.createElement('textarea');
    textarea.className = 'reply-input';
    textarea.rows = 3;
    textarea.maxLength = 1000;
    textarea.style.width = '100%';
    textarea.placeholder = 'お客様に送るメッセージを入力してください';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn';
    sendBtn.textContent = 'LINEで送信する';
    sendBtn.style.marginTop = '8px';
    const msg = document.createElement('p');
    msg.className = 'message';
    msg.hidden = true;
    msg.style.marginTop = '8px';

    sendBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          msg.textContent =
            data.error === 'no_line_user'
              ? 'このお客様のLINEアカウントが確認できないため送信できません(LINE経由でのご予約履歴が必要です)。'
              : '送信に失敗しました。';
          msg.className = 'message message--error';
          msg.hidden = false;
          sendBtn.disabled = false;
          return;
        }
        msg.textContent = '送信しました。';
        msg.className = 'message message--success';
        msg.hidden = false;
        textarea.value = '';
        sendBtn.disabled = false;
      } catch (err) {
        msg.textContent = '通信エラーが発生しました。';
        msg.className = 'message message--error';
        msg.hidden = false;
        sendBtn.disabled = false;
      }
    });

    td.append(label, textarea, sendBtn, msg);
  }

  async function saveCustomer(id, name, memo, btn) {
    const nameTrimmed = name.trim();
    if (!nameTrimmed) {
      alert('お名前を入力してください。');
      return;
    }
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/customers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameTrimmed, memo }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('保存に失敗しました。');
        return;
      }
      loadCustomers();
    } catch (err) {
      alert('通信エラーが発生しました。');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteCustomerAction(id, btn) {
    if (!window.confirm('この顧客情報を削除しますか？（予約の記録自体は消えません）')) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/staff/api/customers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('削除に失敗しました。');
        btn.disabled = false;
        return;
      }
      loadCustomers();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
    }
  }

  document.getElementById('customer-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById('customer-message');
    messageEl.hidden = true;
    const form = e.target;
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = await fetch('/staff/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      });
      const data = await res.json();
      messageEl.hidden = false;
      if (!res.ok || !data.ok) {
        messageEl.className = 'message message--error';
        messageEl.textContent = '追加に失敗しました。';
        return;
      }
      messageEl.className = 'message message--success';
      messageEl.textContent = '追加しました。';
      form.reset();
      loadCustomers();
    } catch (err) {
      messageEl.hidden = false;
      messageEl.className = 'message message--error';
      messageEl.textContent = '通信エラーが発生しました。';
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- パスワード変更 ----------
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById('password-message');
    messageEl.hidden = true;

    const form = e.target;
    const oldPassword = form.oldPassword.value;
    const newPassword = form.newPassword.value;

    try {
      const res = await fetch('/staff/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      messageEl.hidden = false;
      if (!res.ok || !data.ok) {
        messageEl.className = 'message message--error';
        messageEl.textContent = '変更に失敗しました。現在のパスワードをご確認ください。';
        return;
      }
      messageEl.className = 'message message--success';
      messageEl.textContent = 'パスワードを変更しました。';
      form.reset();
    } catch (err) {
      messageEl.hidden = false;
      messageEl.className = 'message message--error';
      messageEl.textContent = '通信エラーが発生しました。';
    }
  });

  // ---------- 店販注文(自分が担当と特定されたものだけ表示) ----------
  async function loadShopOrders() {
    const wrap = document.getElementById('shop-orders-list');
    const empty = document.getElementById('shop-orders-empty');
    wrap.innerHTML = '';
    try {
      const res = await fetch('/staff/api/shop-orders');
      const data = await res.json();
      const orders = data.orders || [];
      empty.hidden = orders.length > 0;
      orders.forEach((o) => wrap.appendChild(renderShopOrderCard(o)));
    } catch (err) {
      empty.hidden = false;
      empty.textContent = '読み込みに失敗しました。';
    }
  }

  function renderShopOrderCard(o) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${o.customer_name}様</strong>（${o.phone}）${o.status === 'done' ? '（対応済み）' : ''}`;
    card.appendChild(title);

    const items = document.createElement('div');
    items.style.marginTop = '6px';
    items.style.fontSize = '13px';
    items.innerHTML = (o.items || []).map((it) => `${it.name} × ${it.quantity}`).join('<br />');
    card.appendChild(items);

    if (o.total_price) {
      const total = document.createElement('div');
      total.style.marginTop = '4px';
      total.style.fontSize = '13px';
      total.textContent = `合計: ${Number(o.total_price).toLocaleString()}円`;
      card.appendChild(total);
    }

    if (o.status !== 'done') {
      const completeBtn = document.createElement('button');
      completeBtn.type = 'button';
      completeBtn.className = 'btn btn--ghost';
      completeBtn.textContent = '対応済みにする';
      completeBtn.style.marginTop = '8px';
      completeBtn.addEventListener('click', async () => {
        completeBtn.disabled = true;
        try {
          const res = await fetch(`/staff/api/shop-orders/${o.id}/complete`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            alert('処理に失敗しました。');
            completeBtn.disabled = false;
            return;
          }
          loadShopOrders();
        } catch (err) {
          alert('通信エラーが発生しました。');
          completeBtn.disabled = false;
        }
      });
      card.appendChild(completeBtn);
    }

    return card;
  }

  init();
})();
