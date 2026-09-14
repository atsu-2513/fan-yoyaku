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
    monthAvailability: {}, // { 'YYYY-MM-DD': 'available' | 'none' | 'closed' }
    quizQuestions: [],
    quizAnswers: [], // 選んだ順に menu_id を積んでいく
    quizIndex: 0,
    mode: 'single', // 'single' | 'candidates'(候補日を複数出して相談するモード)
    candidateList: [], // [{date, time}, ...] 第1〜第3希望まで(順番=希望順)
    viewMode: 'calendar', // 'calendar' | 'week'(週間グリッド表示)
    weekStart: null, // 週間表示中の週の月曜日('YYYY-MM-DD')
    weekAvailability: null, // { weekStart, slotTimes, days } 直近取得ぶん
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
      state.staff = data.staff || [];
      renderStaffOptions();
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
      el.addEventListener('click', async () => {
        state.selectedStaff = staff;
        state.selectedDate = null;
        state.selectedTime = null;
        state.selectedMenu = null;
        resetCandidateMode();
        document.querySelectorAll('#staff-options .menu-option').forEach((o) => o.classList.remove('is-selected'));
        el.classList.add('is-selected');
        document.getElementById('time-section').hidden = true;
        document.getElementById('quiz-section').hidden = true;
        document.getElementById('menu-options').hidden = false;
        state.monthAvailability = {};
        renderCalendar();
        resetWeekView();
        await loadMenusForStaff(staff.id);
        await loadQuizForStaff(staff.id);
        goToStep(2);
      });
      wrap.appendChild(el);
    });
  }

  // ---------- Step 3: Calendar ----------
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
      const isPast = dateStr < today;
      btn.disabled = isPast;
      const status = state.monthAvailability[dateStr];
      let markHtml = '';
      if (!isPast && status === 'available') {
        btn.classList.add('has-availability');
        markHtml = '<span class="day-mark">○</span>';
      } else if (!isPast && (status === 'none' || status === 'closed')) {
        btn.classList.add('no-availability');
      }
      btn.innerHTML = `<span class="day-num">${d}</span>${markHtml}`;
      if (dateStr === state.selectedDate) btn.classList.add('is-selected');
      btn.addEventListener('click', () => selectDate(dateStr));
      grid.appendChild(btn);
    }
  }

  document.getElementById('prev-month').addEventListener('click', () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
    loadMonthAvailability();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
    loadMonthAvailability();
  });

  // 指名スタッフ・メニューが決まったら、表示中の月の空き状況(日付ごとの○/空きなし)をまとめて取得する
  async function loadMonthAvailability() {
    if (!state.selectedStaff || !state.selectedMenu) {
      state.monthAvailability = {};
      renderCalendar();
      return;
    }
    try {
      const y = state.viewMonth.getFullYear();
      const m = state.viewMonth.getMonth() + 1;
      const res = await fetch(
        `/api/booking/availability-month?token=${encodeURIComponent(state.token)}&staffId=${encodeURIComponent(
          state.selectedStaff.id
        )}&menu=${encodeURIComponent(state.selectedMenu.id)}&year=${y}&month=${m}`
      );
      const data = await res.json();
      state.monthAvailability = res.ok && data.ok ? data.days || {} : {};
    } catch (err) {
      state.monthAvailability = {};
    }
    renderCalendar();
  }

  // ---------- 表示切り替え(カレンダー表示 / 週間グリッド表示) ----------
  function setViewMode(mode) {
    state.viewMode = mode;
    document.getElementById('view-toggle-calendar').classList.toggle('is-active', mode === 'calendar');
    document.getElementById('view-toggle-week').classList.toggle('is-active', mode === 'week');
    document.getElementById('calendar-view').hidden = mode !== 'calendar';
    document.getElementById('week-view').hidden = mode !== 'week';
    if (mode === 'week') {
      if (!state.weekStart) state.weekStart = mondayOfLocal(todayStr());
      loadWeekAvailability();
    }
  }

  document.getElementById('view-toggle-calendar').addEventListener('click', () => setViewMode('calendar'));
  document.getElementById('view-toggle-week').addEventListener('click', () => setViewMode('week'));

  document.getElementById('prev-week').addEventListener('click', () => {
    state.weekStart = addDaysLocal(state.weekStart || mondayOfLocal(todayStr()), -7);
    loadWeekAvailability();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    state.weekStart = addDaysLocal(state.weekStart || mondayOfLocal(todayStr()), 7);
    loadWeekAvailability();
  });

  // 指名スタッフ・メニューが決まったら選び直せるよう、週の位置を今週に戻す(表示自体はどちらのビューでも呼び出し側で更新する)
  function resetWeekView() {
    state.weekStart = mondayOfLocal(todayStr());
    state.weekAvailability = null;
  }

  async function loadWeekAvailability() {
    const table = document.getElementById('week-grid-table');
    const label = document.getElementById('week-label');
    if (!state.selectedStaff || !state.selectedMenu || !state.weekStart) {
      table.innerHTML = '';
      return;
    }
    label.textContent = `${state.weekStart} 〜`;
    table.innerHTML = '<tr><td class="week-grid__loading">読み込み中...</td></tr>';
    try {
      const res = await fetch(
        `/api/booking/availability-week?token=${encodeURIComponent(state.token)}&staffId=${encodeURIComponent(
          state.selectedStaff.id
        )}&menu=${encodeURIComponent(state.selectedMenu.id)}&date=${encodeURIComponent(state.weekStart)}`
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        table.innerHTML = '<tr><td class="week-grid__loading">読み込みに失敗しました。</td></tr>';
        return;
      }
      state.weekAvailability = data;
      renderWeekGrid();
    } catch (err) {
      table.innerHTML = '<tr><td class="week-grid__loading">読み込みに失敗しました。</td></tr>';
    }
  }

  const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  function renderWeekGrid() {
    const table = document.getElementById('week-grid-table');
    const data = state.weekAvailability;
    if (data && data.weekStart) {
      state.weekStart = data.weekStart;
      document.getElementById('week-label').textContent = `${data.weekStart} 〜`;
    }
    table.innerHTML = '';
    if (!data || !data.slotTimes || data.slotTimes.length === 0) {
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
      const wd = WEEKDAY_LABELS[d.getDay()];
      th.innerHTML = `${d.getMonth() + 1}/${d.getDate()}<br>${wd}`;
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
        const isPast = day.date < today;
        const isAvailable = !isPast && day.businessDay && day.available.includes(time);
        if (isAvailable) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'week-grid__cell week-grid__cell--available';
          btn.textContent = '◎';
          btn.addEventListener('click', () => chooseDateTime(day.date, time));
          td.appendChild(btn);
        } else {
          td.className = 'week-grid__cell week-grid__cell--unavailable';
          td.textContent = '×';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // カレンダー表示・週間グリッド表示のどちらからでも、日時が選ばれたときの共通処理
  function chooseDateTime(dateStr, time) {
    if (state.mode === 'candidates') {
      addCandidateDate(dateStr, time);
      return;
    }
    state.selectedDate = dateStr;
    state.selectedTime = time;
    goToStep(4);
  }

  async function selectDate(dateStr) {
    if (!state.selectedStaff || !state.selectedMenu) return;
    state.selectedDate = dateStr;
    state.selectedTime = null;
    renderCalendar();

    const timeSection = document.getElementById('time-section');
    const label = document.getElementById('selected-date-label');
    const slotsEl = document.getElementById('time-slots');
    const isCandidateMode = state.mode === 'candidates';
    timeSection.hidden = false;
    label.textContent = isCandidateMode ? `${dateStr} の時間を選択` : `${dateStr} の空き時間`;
    slotsEl.innerHTML = '<p class="time-empty">読み込み中...</p>';

    try {
      // キャンセル待ちモードでは、実際の空き状況(埋まっているかどうか)は問わず、
      // 営業時間内でそのメニューが収まる時間を全て候補として選べるようにする
      const endpoint = isCandidateMode ? '/api/booking/all-slots' : '/api/booking/availability';
      const res = await fetch(
        `${endpoint}?token=${encodeURIComponent(state.token)}&date=${encodeURIComponent(
          dateStr
        )}&staffId=${encodeURIComponent(state.selectedStaff.id)}&menu=${encodeURIComponent(state.selectedMenu.id)}`
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
        slotsEl.innerHTML = isCandidateMode
          ? '<p class="time-empty">この日は選べる時間がありません。</p>'
          : '<p class="time-empty">この日は空きがありません。</p>';
        return;
      }
      slotsEl.innerHTML = '';
      data.slots.forEach((time) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn';
        btn.textContent = time;
        btn.addEventListener('click', () => {
          if (state.mode === 'candidates') {
            addCandidateDate(dateStr, time);
            return;
          }
          state.selectedTime = time;
          document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          goToStep(4);
        });
        slotsEl.appendChild(btn);
      });
    } catch (err) {
      slotsEl.innerHTML = '<p class="time-empty">空き状況の取得に失敗しました。</p>';
    }
  }

  // ---------- 候補日モード(お客様が複数の希望日時を提示して、後でスタッフ/オーナーが1つ確定する) ----------
  function resetCandidateMode() {
    state.mode = 'single';
    state.candidateList = [];
    document.getElementById('candidate-mode-intro').hidden = false;
    document.getElementById('candidate-mode-banner').hidden = true;
    document.getElementById('candidate-list').hidden = true;
    document.getElementById('candidate-list').innerHTML = '';
    document.getElementById('candidate-mode-actions').hidden = true;
    document.getElementById('candidate-continue-btn').hidden = true;
  }

  function renderCandidateList() {
    const wrap = document.getElementById('candidate-list');
    if (state.candidateList.length === 0) {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    wrap.innerHTML = state.candidateList
      .map(
        (c, i) =>
          `<div>第${i + 1}希望: ${c.date} ${c.time} <button type="button" class="btn btn--ghost" data-remove-candidate="${i}" style="padding:2px 8px;margin-left:8px;">取消</button></div>`
      )
      .join('');
    wrap.querySelectorAll('[data-remove-candidate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.removeCandidate);
        state.candidateList.splice(idx, 1);
        renderCandidateList();
        updateCandidateModeUI();
      });
    });
  }

  function updateCandidateModeUI() {
    const roundNum = Math.min(state.candidateList.length + 1, 3);
    document.getElementById('candidate-round-num').textContent = String(roundNum);
    const continueBtn = document.getElementById('candidate-continue-btn');
    continueBtn.hidden = state.candidateList.length === 0;
    document.getElementById('candidate-mode-actions').hidden = false;
  }

  function addCandidateDate(date, time) {
    if (state.candidateList.some((c) => c.date === date && c.time === time)) return;
    if (state.candidateList.length >= 3) return;
    state.candidateList.push({ date, time });
    renderCandidateList();
    updateCandidateModeUI();
    // 次の候補日を選べるように、選択状態と時間枠表示をリセットする
    state.selectedDate = null;
    state.selectedTime = null;
    document.getElementById('time-section').hidden = true;
    renderCalendar();
  }

  document.getElementById('candidate-mode-start-btn').addEventListener('click', () => {
    state.mode = 'candidates';
    state.candidateList = [];
    document.getElementById('candidate-mode-intro').hidden = true;
    document.getElementById('candidate-mode-banner').hidden = false;
    document.getElementById('candidate-mode-actions').hidden = false;
    document.getElementById('candidate-continue-btn').hidden = true;
    updateCandidateModeUI();
  });

  document.getElementById('candidate-mode-cancel-btn').addEventListener('click', () => {
    resetCandidateMode();
    state.selectedDate = null;
    state.selectedTime = null;
    document.getElementById('time-section').hidden = true;
    renderCalendar();
  });

  document.getElementById('candidate-continue-btn').addEventListener('click', () => {
    if (state.candidateList.length === 0) return;
    goToStep(4);
  });

  // ---------- Step 2: Menu ----------
  async function loadMenusForStaff(staffId) {
    const wrap = document.getElementById('menu-options');
    wrap.innerHTML = '<p class="time-empty">読み込み中...</p>';
    try {
      const res = await fetch(
        `/api/booking/menus?token=${encodeURIComponent(state.token)}&staffId=${encodeURIComponent(staffId)}`
      );
      const data = await res.json();
      state.menus = res.ok && data.ok ? data.menus || [] : [];
    } catch (err) {
      state.menus = [];
    }
    renderMenuOptions();
  }

  // 「迷ったら質問に答えて探す」用の質問一覧を読み込む(質問が1つもなければボタン自体を隠す)
  async function loadQuizForStaff(staffId) {
    const quizBtn = document.getElementById('quiz-start-btn');
    try {
      const res = await fetch(
        `/api/booking/quiz?token=${encodeURIComponent(state.token)}&staffId=${encodeURIComponent(staffId)}`
      );
      const data = await res.json();
      state.quizQuestions = res.ok && data.ok ? data.questions || [] : [];
    } catch (err) {
      state.quizQuestions = [];
    }
    quizBtn.hidden = state.quizQuestions.length === 0;
  }

  function exitQuiz() {
    document.getElementById('quiz-section').hidden = true;
    document.getElementById('quiz-result-view').hidden = true;
    document.getElementById('menu-options').hidden = false;
    document.getElementById('quiz-start-btn').hidden = state.quizQuestions.length === 0;
  }

  document.getElementById('quiz-start-btn').addEventListener('click', () => {
    state.quizAnswers = [];
    state.quizIndex = 0;
    document.getElementById('menu-options').hidden = true;
    document.getElementById('quiz-start-btn').hidden = true;
    document.getElementById('quiz-result-view').hidden = true;
    document.getElementById('quiz-section').hidden = false;
    renderQuizQuestion();
  });

  document.getElementById('quiz-cancel-btn').addEventListener('click', exitQuiz);

  function renderQuizQuestion() {
    const view = document.getElementById('quiz-question-view');
    const resultView = document.getElementById('quiz-result-view');
    resultView.hidden = true;
    view.hidden = false;
    const q = state.quizQuestions[state.quizIndex];
    if (!q) {
      finishQuiz();
      return;
    }
    view.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = `${q.prompt}`;
    view.appendChild(heading);
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'menu-options';
    (q.options || []).forEach((o) => {
      const el = document.createElement('div');
      el.className = 'menu-option';
      el.textContent = o.label;
      el.addEventListener('click', () => {
        state.quizAnswers.push(o.menu_id);
        state.quizIndex += 1;
        renderQuizQuestion();
      });
      optionsWrap.appendChild(el);
    });
    view.appendChild(optionsWrap);
  }

  function finishQuiz() {
    document.getElementById('quiz-question-view').hidden = true;
    const resultView = document.getElementById('quiz-result-view');
    resultView.hidden = false;

    const counts = {};
    state.quizAnswers.forEach((menuId) => {
      counts[menuId] = (counts[menuId] || 0) + 1;
    });
    let bestMenuId = null;
    let bestCount = -1;
    // state.menus はそのスタッフの提供順(sort_order)なので、同数の場合はその順で最初のものを採用する
    state.menus.forEach((m) => {
      const c = counts[m.id] || 0;
      if (c > bestCount) {
        bestCount = c;
        bestMenuId = m.id;
      }
    });
    const recommended = state.menus.find((m) => m.id === bestMenuId);

    resultView.innerHTML = '';
    if (!recommended) {
      resultView.innerHTML = '<p class="time-empty">おすすめを見つけられませんでした。一覧からお選びください。</p>';
      return;
    }
    const heading = document.createElement('h3');
    heading.textContent = 'おすすめのメニューはこちらです';
    const card = document.createElement('div');
    card.className = 'menu-option is-selected';
    card.textContent = menuOptionText(recommended);
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.className = 'btn';
    chooseBtn.style.marginTop = '12px';
    chooseBtn.textContent = 'このメニューにする';
    chooseBtn.addEventListener('click', () => {
      state.selectedMenu = recommended;
      state.selectedDate = null;
      state.selectedTime = null;
      document.getElementById('time-section').hidden = true;
      exitQuiz();
      resetCandidateMode();
      resetWeekView();
      loadMonthAvailability();
      if (state.viewMode === 'week') loadWeekAvailability();
      goToStep(3);
    });
    resultView.append(heading, card, chooseBtn);
  }

  function menuOptionText(menu) {
    const priceText = menu.price != null && menu.price !== '' ? `¥${Number(menu.price).toLocaleString()}・` : '';
    const durationText = menu.durationMinutes ? `約${menu.durationMinutes}分` : '';
    const detail = [priceText, durationText].filter(Boolean).join('');
    return detail ? `${menu.label}（${detail}）` : menu.label;
  }

  function renderMenuOptions() {
    const wrap = document.getElementById('menu-options');
    wrap.innerHTML = '';
    if (!state.menus.length) {
      wrap.innerHTML = '<p class="time-empty">現在このスタッフが対応できるメニューがありません。お手数ですが店舗にお問い合わせください。</p>';
      return;
    }
    state.menus.forEach((menu) => {
      const el = document.createElement('div');
      el.className = 'menu-option';
      el.textContent = menuOptionText(menu);
      el.addEventListener('click', () => {
        state.selectedMenu = menu;
        state.selectedDate = null;
        state.selectedTime = null;
        document.querySelectorAll('#menu-options .menu-option').forEach((o) => o.classList.remove('is-selected'));
        el.classList.add('is-selected');
        document.getElementById('time-section').hidden = true;
        resetCandidateMode();
        resetWeekView();
        loadMonthAvailability();
        if (state.viewMode === 'week') loadWeekAvailability();
        goToStep(3);
      });
      wrap.appendChild(el);
    });
  }

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
    const staffLine = `<div>担当: ${state.selectedStaff ? state.selectedStaff.name : ''}</div>`;
    const menuLine = `<div>メニュー: ${state.selectedMenu ? menuOptionText(state.selectedMenu) : ''}</div>`;
    const submitBtn = document.querySelector('#customer-form button[type="submit"]');
    if (state.mode === 'candidates') {
      const datesHtml = state.candidateList
        .map((c, i) => `<div>第${i + 1}希望: ${c.date} ${c.time}</div>`)
        .join('');
      el.innerHTML = staffLine + datesHtml + menuLine;
      if (submitBtn) submitBtn.textContent = '候補日を送信する';
    } else {
      el.innerHTML = `${staffLine}<div>日時: ${state.selectedDate} ${state.selectedTime}</div>${menuLine}`;
      if (submitBtn) submitBtn.textContent = '予約する';
    }
  }

  // ---------- Step 4: Submit ----------
  document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('submit-error');
    errorEl.hidden = true;

    const form = e.target;
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const consultation = form.consultation.value.trim();

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const isCandidateMode = state.mode === 'candidates';
    const endpoint = isCandidateMode ? '/api/booking/candidates' : '/api/booking';
    const payload = isCandidateMode
      ? {
          token: state.token,
          staffId: state.selectedStaff ? state.selectedStaff.id : null,
          menu: state.selectedMenu ? state.selectedMenu.id : null,
          name,
          phone,
          consultation,
          dates: state.candidateList,
        }
      : {
          token: state.token,
          staffId: state.selectedStaff ? state.selectedStaff.id : null,
          date: state.selectedDate,
          time: state.selectedTime,
          menu: state.selectedMenu ? state.selectedMenu.id : null,
          name,
          phone,
          consultation,
        };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      document.getElementById('done-message-single').hidden = isCandidateMode;
      document.getElementById('done-message-candidates').hidden = !isCandidateMode;
      showScreen(doneScreen);
    } catch (err) {
      errorEl.textContent = '通信エラーが発生しました。もう一度お試しください。';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  init();
})();
