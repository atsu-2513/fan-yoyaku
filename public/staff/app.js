(function () {
  const state = {
    staff: null,
    viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: null,
    openSlots: [],
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
      btn.addEventListener('click', () => selectDate(dateStr));
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

  async function selectDate(dateStr) {
    state.selectedDate = dateStr;
    renderCalendar();

    const section = document.getElementById('slot-section');
    const label = document.getElementById('selected-date-label');
    const grid = document.getElementById('slot-grid');
    section.hidden = false;
    label.textContent = `${dateStr} の空き時間`;
    grid.innerHTML = '<p class="slot-hint">読み込み中...</p>';

    try {
      const res = await fetch(`/staff/api/slots?date=${encodeURIComponent(dateStr)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        grid.innerHTML = '<p class="slot-hint">読み込みに失敗しました。</p>';
        return;
      }
      if (!data.businessDay) {
        grid.innerHTML = '<p class="slot-hint">この日は定休日のため設定できません。</p>';
        return;
      }
      renderSlotGrid(dateStr, data.candidateSlots, data.openSlots);
    } catch (err) {
      grid.innerHTML = '<p class="slot-hint">読み込みに失敗しました。</p>';
    }
  }

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
  async function loadReservations() {
    const tbody = document.getElementById('reservations-body');
    const emptyMessage = document.getElementById('empty-message');
    tbody.innerHTML = '';
    try {
      const res = await fetch('/staff/api/reservations');
      const data = await res.json();
      const reservations = data.reservations || [];
      emptyMessage.hidden = reservations.length > 0;
      reservations.forEach((r) => tbody.appendChild(renderRow(r)));
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
    badge.textContent = r.status === 'confirmed' ? '確定' : '仮予約';
    statusTd.appendChild(badge);

    const dateTd = document.createElement('td');
    dateTd.textContent = `${r.date} ${r.time}`;

    const menuTd = document.createElement('td');
    menuTd.textContent = r.menuLabel;

    const nameTd = document.createElement('td');
    nameTd.textContent = r.name;

    const phoneTd = document.createElement('td');
    phoneTd.textContent = r.phone;

    const actionTd = document.createElement('td');
    if (r.status === 'confirmed') {
      actionTd.textContent = '—';
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '確定する';
      btn.addEventListener('click', () => confirmReservation(r.id, btn));
      actionTd.appendChild(btn);
    }

    tr.append(statusTd, dateTd, menuTd, nameTd, phoneTd, actionTd);
    return tr;
  }

  async function confirmReservation(id, btn) {
    btn.disabled = true;
    btn.textContent = '送信中...';
    try {
      const res = await fetch(`/staff/api/reservations/${id}/confirm`, { method: 'POST' });
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

  init();
})();
