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
      loadCustomers();
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
    if (r.status === 'cancelled') {
      actionTd.textContent = '—';
    } else {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.gap = '6px';
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
      actionTd.appendChild(wrap);
    }

    tr.append(statusTd, dateTd, menuTd, consultTd, nameTd, phoneTd, actionTd);
    return tr;
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
    wrap.append(saveBtn, deleteBtn, historyBtn);
    actionTd.appendChild(wrap);

    tr.append(nameTd, phoneTd, countTd, lastVisitTd, memoTd, actionTd);

    const historyTr = document.createElement('tr');
    historyTr.hidden = true;
    const historyTd = document.createElement('td');
    historyTd.colSpan = 6;
    historyTd.className = 'history-cell';
    historyTr.appendChild(historyTd);
    historyBtn.addEventListener('click', () => toggleCustomerHistory(c.id, historyTr, historyTd, historyBtn));

    const frag = document.createDocumentFragment();
    frag.append(tr, historyTr);
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

  init();
})();
