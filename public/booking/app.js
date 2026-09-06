(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  const errorScreen = document.getElementById('error-screen');
  const formScreen = document.getElementById('form-screen');
  const doneScreen = document.getElementById('done-screen');

  const state = {
    token,
    menus: [],
    staff: [],
    viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedStaff: null,
    selectedDate: null, // 'YYYY-MM-DD'
    selectedTime: null,
    selectedMenu: null,
  };

  function showScreen(el) {
    [errorScreen, formScreen, doneScreen].forEach((s) => (s.hidden = s !== el));
  }

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
    if (!token) {
      showScreen(errorScreen);
      return;
    }
    try {
      const res = await fetch(`/api/booking/token/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showScreen(errorScreen);
        return;
      }
      state.menus = data.menus || [];
      state.staff = data.staff || [];
      renderStaffOptions();
      renderMenuOptions();
      renderCalendar();
      showScreen(formScreen);
    } catch (err) {
      showScreen(errorScreen);
    }
  }

  // ---------- Step 1: 担当者 ----------
  function renderStaffOptions() {
    const wrap = document.getElementById('staff-options');
    wrap.innerHTML = '';
    if (!state.staff.length) {
      wrap.innerHTML = '<p class="time-empty">現在指名可能なスタッフがいません。お手数ですが店舗にお問い合わせください。</p>';
      return;
    }
    state.staff.forEach((staff) => {
      const el = document.createElement('div');
      el.className = 'menu-option';
      el.textContent = staff.name;
      el.addEventListener('click', () => {
        state.selectedStaff = staff;
        state.selectedDate = null;
        state.selectedTime = null;
        document.querySelectorAll('#staff-options .menu-option').forEach((o) => o.classList.remove('is-selected'));
        el.classList.add('is-selected');
        document.getElementById('time-section').hidden = true;
        renderCalendar();
        goToStep(2);
      });
      wrap.appendChild(el);
    });
  }

  // ---------- Step 2: Calendar ----------
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
      const isPast = dateStr < today;
      btn.disabled = isPast;
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
    if (!state.selectedStaff) return;
    state.selectedDate = dateStr;
    state.selectedTime = null;
    renderCalendar();

    const timeSection = document.getElementById('time-section');
    const label = document.getElementById('selected-date-label');
    const slotsEl = document.getElementById('time-slots');
    timeSection.hidden = false;
    label.textContent = `${dateStr} の空き時間`;
    slotsEl.innerHTML = '<p class="time-empty">読み込み中...</p>';

    try {
      const res = await fetch(
        `/api/booking/availability?token=${encodeURIComponent(state.token)}&date=${encodeURIComponent(
          dateStr
        )}&staffId=${encodeURIComponent(state.selectedStaff.id)}`
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        slotsEl.innerHTML = '<p class="time-empty">空き状況の取得に失敗しました。</p>';
        return;
      }
      if (!data.businessDay) {
        slotsEl.innerHTML = '<p class="time-empty">この日は定休日です。</p>';
        return;
      }
      if (!data.slots.length) {
        slotsEl.innerHTML = '<p class="time-empty">この日は空きがありません。</p>';
        return;
      }
      slotsEl.innerHTML = '';
      data.slots.forEach((time) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn';
        btn.textContent = time;
        btn.addEventListener('click', () => {
          state.selectedTime = time;
          document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          goToStep(3);
        });
        slotsEl.appendChild(btn);
      });
    } catch (err) {
      slotsEl.innerHTML = '<p class="time-empty">空き状況の取得に失敗しました。</p>';
    }
  }

  // ---------- Step 3: Menu ----------
  function renderMenuOptions() {
    const wrap = document.getElementById('menu-options');
    wrap.innerHTML = '';
    state.menus.forEach((menu) => {
      const el = document.createElement('div');
      el.className = 'menu-option';
      el.textContent = menu.label;
      el.addEventListener('click', () => {
        state.selectedMenu = menu;
        document.querySelectorAll('#menu-options .menu-option').forEach((o) => o.classList.remove('is-selected'));
        el.classList.add('is-selected');
        document.getElementById('to-step-4').disabled = false;
      });
      wrap.appendChild(el);
    });
  }

  document.getElementById('to-step-4').addEventListener('click', () => goToStep(4));

  // ---------- Step navigation ----------
  function goToStep(n) {
    [1, 2, 3, 4].forEach((i) => {
      document.getElementById(`step-${i}`).classList.toggle('is-active', i === n);
      document.getElementById(`step-indicator-${i}`).classList.toggle('is-active', i === n);
    });
    if (n === 4) renderSummary();
  }

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.back)));
  });

  function renderSummary() {
    const el = document.getElementById('booking-summary');
    el.innerHTML = `
      <div>担当: ${state.selectedStaff ? state.selectedStaff.name : ''}</div>
      <div>日時: ${state.selectedDate} ${state.selectedTime}</div>
      <div>メニュー: ${state.selectedMenu ? state.selectedMenu.label : ''}</div>
    `;
  }

  // ---------- Step 4: Submit ----------
  document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('submit-error');
    errorEl.hidden = true;

    const form = e.target;
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: state.token,
          staffId: state.selectedStaff ? state.selectedStaff.id : null,
          date: state.selectedDate,
          time: state.selectedTime,
          menu: state.selectedMenu ? state.selectedMenu.id : null,
          name,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        errorEl.textContent =
          data.error === 'slot_taken'
            ? 'その時間はすでに予約済みです。お手数ですが日時を選び直してください。'
            : '予約に失敗しました。もう一度お試しください。';
        errorEl.hidden = false;
        submitBtn.disabled = false;
        return;
      }
      showScreen(doneScreen);
    } catch (err) {
      errorEl.textContent = '通信エラーが発生しました。もう一度お試しください。';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  init();
})();
