(function () {
  const tbody = document.getElementById('reservations-body');
  const emptyMessage = document.getElementById('empty-message');

  async function load() {
    tbody.innerHTML = '';
    try {
      const res = await fetch('/api/admin/reservations');
      if (res.status === 401) {
        document.body.innerHTML = '<p style="padding:24px">認証に失敗しました。ページを再読み込みしてください。</p>';
        return;
      }
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

    const staffTd = document.createElement('td');
    staffTd.textContent = r.staff_name || '(未設定)';

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
      cancelBtn.addEventListener('click', () => cancelReservation(r.id, cancelBtn));
      wrap.appendChild(cancelBtn);
      rescheduleBtn = document.createElement('button');
      rescheduleBtn.className = 'btn btn--ghost';
      rescheduleBtn.textContent = '日時を変更する';
      wrap.appendChild(rescheduleBtn);
      actionTd.appendChild(wrap);
    }

    tr.append(statusTd, dateTd, staffTd, menuTd, consultTd, nameTd, phoneTd, actionTd);

    const rescheduleTr = document.createElement('tr');
    rescheduleTr.hidden = true;
    const rescheduleTd = document.createElement('td');
    rescheduleTd.colSpan = 8;
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
        const res = await fetch(`/api/admin/reservations/${r.id}/availability?date=${encodeURIComponent(date)}`);
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
      const res = await fetch(`/api/admin/reservations/${id}/reschedule`, {
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
      load();
      loadWaitlistAlerts();
    } catch (err) {
      msg.textContent = '通信エラーが発生しました。';
      msg.className = 'message message--error';
      msg.hidden = false;
      btn.disabled = false;
    }
  }

  async function confirmReservation(id, btn, reply) {
    btn.disabled = true;
    btn.textContent = '送信中...';
    try {
      const res = await fetch(`/api/admin/reservations/${id}/confirm`, {
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
      load();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
      btn.textContent = '確定する';
    }
  }

  async function cancelReservation(id, btn) {
    if (!window.confirm('このご予約をキャンセルしますか？お客様にLINEで通知が送信されます。')) return;
    btn.disabled = true;
    btn.textContent = '処理中...';
    try {
      const res = await fetch(`/api/admin/reservations/${id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert('キャンセル処理に失敗しました。');
        btn.disabled = false;
        btn.textContent = 'キャンセル';
        return;
      }
      load();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
      btn.textContent = 'キャンセル';
    }
  }

  document.getElementById('refresh').addEventListener('click', load);

  // ---------- スタッフの空き状況 ----------
  async function initStaffSlots() {
    const select = document.getElementById('staff-slots-select');
    const dateInput = document.getElementById('staff-slots-date');
    const loadBtn = document.getElementById('staff-slots-load');

    const todayStr = new Date().toISOString().slice(0, 10);
    dateInput.value = todayStr;

    try {
      const res = await fetch('/api/admin/staff');
      const data = await res.json();
      (data.staff || []).forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + (s.active ? '' : '(無効)');
        select.appendChild(opt);
      });
    } catch (err) {
      // スタッフ一覧の取得に失敗しても予約一覧の表示は続ける
    }

    loadBtn.addEventListener('click', loadStaffSlots);
  }

  async function loadStaffSlots() {
    const select = document.getElementById('staff-slots-select');
    const dateInput = document.getElementById('staff-slots-date');
    const tbody = document.getElementById('staff-slots-body');
    const message = document.getElementById('staff-slots-message');
    tbody.innerHTML = '';
    message.hidden = true;

    const staffId = select.value;
    const date = dateInput.value;
    if (!staffId || !date) return;

    try {
      const res = await fetch(`/api/admin/staff/${staffId}/slots?date=${encodeURIComponent(date)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        message.hidden = false;
        message.textContent = '読み込みに失敗しました。';
        return;
      }
      if (!data.businessDay) {
        message.hidden = false;
        message.textContent = 'この日は定休日です。';
        return;
      }
      if (data.candidateSlots.length === 0) {
        message.hidden = false;
        message.textContent = '表示できる時間帯がありません。';
        return;
      }
      const open = new Set(data.openSlots);
      const taken = new Set(data.takenSlots);
      data.candidateSlots.forEach((time) => {
        const tr = document.createElement('tr');
        const timeTd = document.createElement('td');
        timeTd.textContent = time;
        const statusTd = document.createElement('td');
        if (taken.has(time)) {
          statusTd.textContent = '予約済み';
        } else if (open.has(time)) {
          statusTd.textContent = '受付中(空きあり)';
        } else {
          statusTd.textContent = '未開放';
        }
        tr.append(timeTd, statusTd);
        tbody.appendChild(tr);
      });
    } catch (err) {
      message.hidden = false;
      message.textContent = '読み込みに失敗しました。';
    }
  }

  // ---------- 定休日・営業時間 ----------
  function populateHourSelects() {
    const openSelect = document.getElementById('open-hour-select');
    const closeSelect = document.getElementById('close-hour-select');
    for (let h = 0; h <= 23; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = `${String(h).padStart(2, '0')}:00`;
      openSelect.appendChild(opt);
    }
    for (let h = 1; h <= 24; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = `${String(h % 24).padStart(2, '0')}:00`;
      closeSelect.appendChild(opt);
    }
  }

  async function initSettings() {
    populateHourSelects();
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      const s = data.settings;
      document.querySelectorAll('#weekday-checks input[type="checkbox"]').forEach((cb) => {
        cb.checked = s.closedWeekdays.includes(Number(cb.value));
      });
      document.getElementById('open-hour-select').value = String(s.openHour);
      document.getElementById('close-hour-select').value = String(s.closeHour);
    } catch (err) {
      // 読み込み失敗時はデフォルト表示のまま
    }

    document.getElementById('settings-save').addEventListener('click', async () => {
      const message = document.getElementById('settings-message');
      const closedWeekdays = Array.from(document.querySelectorAll('#weekday-checks input:checked')).map((cb) =>
        Number(cb.value)
      );
      const openHour = Number(document.getElementById('open-hour-select').value);
      const closeHour = Number(document.getElementById('close-hour-select').value);
      message.hidden = true;
      try {
        const res = await fetch('/api/admin/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ closedWeekdays, openHour, closeHour }),
        });
        const data = await res.json();
        message.hidden = false;
        if (!res.ok || !data.ok) {
          message.textContent = '保存に失敗しました（開店・閉店時刻をご確認ください）。';
          return;
        }
        message.textContent = '保存しました。';
      } catch (err) {
        message.hidden = false;
        message.textContent = '通信エラーが発生しました。';
      }
    });
  }

  // ---------- メニュー管理(共通カタログ) ----------
  async function loadMenuCatalog() {
    const tbody = document.getElementById('menu-body');
    tbody.innerHTML = '';
    const res = await fetch('/api/admin/menus');
    const data = await res.json();
    const menus = data.menus || [];
    menus.forEach((m) => tbody.appendChild(renderMenuRow(m)));
    return menus;
  }

  function renderMenuRow(m) {
    const tr = document.createElement('tr');

    const labelTd = document.createElement('td');
    const labelInput = document.createElement('input');
    labelInput.className = 'menu-table-input';
    labelInput.type = 'text';
    labelInput.value = m.label;
    labelTd.appendChild(labelInput);

    const priceTd = document.createElement('td');
    const priceInput = document.createElement('input');
    priceInput.className = 'menu-table-input';
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.value = m.price != null ? m.price : '';
    priceTd.appendChild(priceInput);

    const durationTd = document.createElement('td');
    const durationInput = document.createElement('input');
    durationInput.className = 'menu-table-input';
    durationInput.type = 'number';
    durationInput.min = '30';
    durationInput.step = '30';
    durationInput.value = m.duration_minutes || 60;
    durationTd.appendChild(durationInput);

    const activeTd = document.createElement('td');
    const activeCheck = document.createElement('input');
    activeCheck.type = 'checkbox';
    activeCheck.checked = Number(m.active) === 1;
    activeTd.appendChild(activeCheck);

    const actionTd = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--ghost';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const message = document.getElementById('menu-message');
      try {
        const res = await fetch(`/api/admin/menus/${encodeURIComponent(m.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: labelInput.value.trim(),
            price: priceInput.value === '' ? null : Number(priceInput.value),
            durationMinutes: durationInput.value === '' ? 60 : Number(durationInput.value),
            active: activeCheck.checked,
          }),
        });
        const data = await res.json();
        message.hidden = false;
        message.textContent = res.ok && data.ok ? '保存しました。' : '保存に失敗しました。';
      } catch (err) {
        message.hidden = false;
        message.textContent = '通信エラーが発生しました。';
      } finally {
        saveBtn.disabled = false;
      }
    });
    actionTd.appendChild(saveBtn);

    tr.append(labelTd, priceTd, durationTd, activeTd, actionTd);
    return tr;
  }

  function initMenus() {
    loadMenuCatalog();

    document.getElementById('menu-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const labelInput = document.getElementById('new-menu-label');
      const priceInput = document.getElementById('new-menu-price');
      const durationInput = document.getElementById('new-menu-duration');
      const message = document.getElementById('menu-message');
      const label = labelInput.value.trim();
      if (!label) return;
      try {
        const res = await fetch('/api/admin/menus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label,
            price: priceInput.value === '' ? null : Number(priceInput.value),
            durationMinutes: durationInput.value === '' ? 60 : Number(durationInput.value),
          }),
        });
        const data = await res.json();
        message.hidden = false;
        if (!res.ok || !data.ok) {
          message.textContent = '追加に失敗しました。';
          return;
        }
        message.textContent = 'メニューを追加しました。';
        labelInput.value = '';
        priceInput.value = '';
        durationInput.value = '60';
        loadMenuCatalog();
      } catch (err) {
        message.hidden = false;
        message.textContent = '通信エラーが発生しました。';
      }
    });
  }

  // ---------- スタッフごとのメニュー調整 ----------
  async function initStaffMenuAdjust() {
    const select = document.getElementById('staff-menu-select');
    try {
      const res = await fetch('/api/admin/staff');
      const data = await res.json();
      (data.staff || []).forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + (s.active ? '' : '(無効)');
        select.appendChild(opt);
      });
    } catch (err) {
      // 一覧取得失敗時は無視
    }
    document.getElementById('staff-menu-load').addEventListener('click', loadStaffMenuAdjust);
    document.getElementById('staff-menu-save').addEventListener('click', saveStaffMenuAdjust);
  }

  async function loadStaffMenuAdjust() {
    const select = document.getElementById('staff-menu-select');
    const tbody = document.getElementById('staff-menu-body');
    const message = document.getElementById('staff-menu-message');
    tbody.innerHTML = '';
    message.hidden = true;
    const staffId = select.value;
    if (!staffId) return;

    try {
      const res = await fetch(`/api/admin/staff/${staffId}/menus`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        message.hidden = false;
        message.textContent = '読み込みに失敗しました。';
        return;
      }
      const overrideMap = new Map((data.overrides || []).map((o) => [o.menu_id, o]));
      (data.catalog || []).forEach((m) => {
        const o = overrideMap.get(m.id);
        const tr = document.createElement('tr');
        tr.dataset.menuId = m.id;

        const labelTd = document.createElement('td');
        labelTd.textContent = m.label + (Number(m.active) === 1 ? '' : '（非公開）');

        const priceTd = document.createElement('td');
        priceTd.textContent = m.price != null ? `¥${Number(m.price).toLocaleString()}` : '未設定';

        const durationTd = document.createElement('td');
        durationTd.textContent = `${m.duration_minutes || 60}分`;

        const enabledTd = document.createElement('td');
        const enabledCheck = document.createElement('input');
        enabledCheck.type = 'checkbox';
        enabledCheck.className = 'staff-menu-enabled';
        enabledCheck.checked = !o || Number(o.enabled) !== 0;
        enabledTd.appendChild(enabledCheck);

        const overrideTd = document.createElement('td');
        const overrideInput = document.createElement('input');
        overrideInput.type = 'number';
        overrideInput.min = '0';
        overrideInput.className = 'menu-table-input staff-menu-override';
        overrideInput.placeholder = '共通価格のまま';
        overrideInput.value = o && o.price_override != null ? o.price_override : '';
        overrideTd.appendChild(overrideInput);

        tr.append(labelTd, priceTd, durationTd, enabledTd, overrideTd);
        tbody.appendChild(tr);
      });
    } catch (err) {
      message.hidden = false;
      message.textContent = '読み込みに失敗しました。';
    }
  }

  async function saveStaffMenuAdjust() {
    const select = document.getElementById('staff-menu-select');
    const tbody = document.getElementById('staff-menu-body');
    const message = document.getElementById('staff-menu-message');
    const staffId = select.value;
    if (!staffId) return;

    const overrides = Array.from(tbody.querySelectorAll('tr')).map((tr) => {
      const overrideInput = tr.querySelector('.staff-menu-override');
      return {
        menuId: tr.dataset.menuId,
        enabled: tr.querySelector('.staff-menu-enabled').checked,
        priceOverride: overrideInput.value === '' ? null : Number(overrideInput.value),
      };
    });

    try {
      const res = await fetch(`/api/admin/staff/${staffId}/menus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      message.hidden = false;
      message.textContent = res.ok && data.ok ? '保存しました。' : '保存に失敗しました。';
    } catch (err) {
      message.hidden = false;
      message.textContent = '通信エラーが発生しました。';
    }
  }

  // ---------- スタッフの通知先メールアドレス ----------
  async function initStaffEmails() {
    const tbody = document.getElementById('staff-email-body');
    const message = document.getElementById('staff-email-message');
    tbody.innerHTML = '';
    try {
      const res = await fetch('/api/admin/staff');
      const data = await res.json();
      (data.staff || []).forEach((s) => {
        const tr = document.createElement('tr');
        const nameTd = document.createElement('td');
        nameTd.textContent = s.name + (s.active ? '' : '(無効)');

        const emailTd = document.createElement('td');
        const emailInput = document.createElement('input');
        emailInput.type = 'email';
        emailInput.className = 'menu-table-input';
        emailInput.placeholder = 'example@gmail.com';
        emailInput.value = s.email || '';
        emailTd.appendChild(emailInput);

        const actionTd = document.createElement('td');
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn--ghost';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          try {
            const res2 = await fetch(`/api/admin/staff/${s.id}/email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: emailInput.value.trim() }),
            });
            const data2 = await res2.json();
            message.hidden = false;
            message.textContent = res2.ok && data2.ok ? '保存しました。' : 'メールアドレスの形式をご確認ください。';
          } catch (err) {
            message.hidden = false;
            message.textContent = '通信エラーが発生しました。';
          } finally {
            saveBtn.disabled = false;
          }
        });
        actionTd.appendChild(saveBtn);

        tr.append(nameTd, emailTd, actionTd);
        tbody.appendChild(tr);
      });
    } catch (err) {
      message.hidden = false;
      message.textContent = '読み込みに失敗しました。';
    }
  }

  // ---------- 候補日リクエスト(全スタッフ) ----------
  async function loadCandidateRequests() {
    const wrap = document.getElementById('candidate-requests-list');
    const empty = document.getElementById('candidate-requests-empty');
    wrap.innerHTML = '';
    try {
      const res = await fetch('/api/admin/candidate-requests');
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
    card.style.border = '1px solid #ddd';
    card.style.borderRadius = '8px';
    card.style.padding = '12px';
    card.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${r.name}様</strong>（${r.phone}）・担当: ${r.staff_name || '(未設定)'}`;
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
      const res = await fetch(`/api/admin/candidate-requests/${id}/confirm`, {
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
      load();
    } catch (err) {
      alert('通信エラーが発生しました。');
      btn.disabled = false;
    }
  }

  async function declineCandidateRequestAction(id, btn) {
    if (!window.confirm('どの候補日も難しい旨をお客様にお伝えして見送りますか？')) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/candidate-requests/${id}/decline`, { method: 'POST' });
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

  // ---------- 空き通知(全スタッフ) ----------
  async function loadWaitlistAlerts() {
    const wrap = document.getElementById('waitlist-alerts-list');
    const empty = document.getElementById('waitlist-alerts-empty');
    wrap.innerHTML = '';
    try {
      const res = await fetch('/api/admin/waitlist-alerts');
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
    card.style.border = '1px solid #ddd';
    card.style.borderRadius = '8px';
    card.style.padding = '12px';
    card.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${a.date} ${a.time}</strong> に空きが出ました（${a.name}様の第一希望・担当: ${
      a.staff_name || '(未設定)'
    }）`;
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
      const res = await fetch(`/api/admin/waitlist-alerts/${id}/notify`, {
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
      const res = await fetch(`/api/admin/waitlist-alerts/${id}/dismiss`, { method: 'POST' });
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

  async function loadCustomers() {
    const tbody = document.getElementById('customers-body');
    const emptyMessage = document.getElementById('customers-empty-message');
    tbody.innerHTML = '';
    try {
      const res = await fetch('/api/admin/customers');
      const data = await res.json();
      const customers = data.customers || [];
      emptyMessage.hidden = customers.length > 0;
      customers.forEach((c) => {
        const tr = document.createElement('tr');
        const staffTd = document.createElement('td');
        staffTd.textContent = c.staff_name || '—';
        const nameTd = document.createElement('td');
        nameTd.textContent = c.name;
        const phoneTd = document.createElement('td');
        phoneTd.textContent = c.phone;
        const countTd = document.createElement('td');
        countTd.textContent = c.visit_count || 0;
        const lastVisitTd = document.createElement('td');
        lastVisitTd.textContent = c.last_visit_date || '—';
        const memoTd = document.createElement('td');
        memoTd.textContent = c.memo || '—';
        memoTd.style.whiteSpace = 'pre-wrap';
        memoTd.style.fontSize = '12px';
        const actionTd = document.createElement('td');
        const historyBtn = document.createElement('button');
        historyBtn.className = 'btn btn--ghost';
        historyBtn.textContent = '履歴を見る';
        actionTd.appendChild(historyBtn);
        tr.append(staffTd, nameTd, phoneTd, countTd, lastVisitTd, memoTd, actionTd);
        tbody.appendChild(tr);

        const historyTr = document.createElement('tr');
        historyTr.hidden = true;
        const historyTd = document.createElement('td');
        historyTd.colSpan = 7;
        historyTd.className = 'history-cell';
        historyTr.appendChild(historyTd);
        historyBtn.addEventListener('click', () => toggleCustomerHistory(c.id, historyTr, historyTd, historyBtn));
        tbody.appendChild(historyTr);
      });
    } catch (err) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = '読み込みに失敗しました。';
    }
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
    historyTd.innerHTML = '<p class="empty-message">読み込み中...</p>';
    try {
      const res = await fetch(`/api/admin/customers/${id}/history`);
      const data = await res.json();
      const history = data.history || [];
      if (!res.ok || !data.ok) {
        historyTd.innerHTML = '<p class="empty-message">読み込みに失敗しました。</p>';
      } else if (!history.length) {
        historyTd.innerHTML = '<p class="empty-message">来店履歴はまだありません。</p>';
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
      historyTd.innerHTML = '<p class="empty-message">通信エラーが発生しました。</p>';
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- メニュー診断クイズ ----------
  let quizMenuCatalog = [];

  function buildMenuSelect(selectedId) {
    const select = document.createElement('select');
    quizMenuCatalog.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function renderQuizQuestionCard(q) {
    const card = document.createElement('div');
    card.className = 'quiz-question-card';

    const headerRow = document.createElement('div');
    headerRow.className = 'quiz-question-header';
    const promptInput = document.createElement('input');
    promptInput.type = 'text';
    promptInput.value = q.prompt;
    promptInput.className = 'menu-table-input';
    promptInput.style.flex = '1';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--ghost';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', async () => {
      const prompt = promptInput.value.trim();
      if (!prompt) return;
      saveBtn.disabled = true;
      try {
        const res = await fetch(`/api/admin/quiz/questions/${q.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        if (res.ok && data.ok) loadQuizQuestions();
      } finally {
        saveBtn.disabled = false;
      }
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn--ghost';
    deleteBtn.textContent = '質問を削除';
    deleteBtn.addEventListener('click', async () => {
      if (!window.confirm('この質問と選択肢をすべて削除しますか？')) return;
      await fetch(`/api/admin/quiz/questions/${q.id}`, { method: 'DELETE' });
      loadQuizQuestions();
    });
    headerRow.append(promptInput, saveBtn, deleteBtn);
    card.appendChild(headerRow);

    const optionsTable = document.createElement('table');
    optionsTable.className = 'table';
    optionsTable.innerHTML = '<thead><tr><th>選択肢</th><th>おすすめメニュー</th><th>操作</th></tr></thead>';
    const optionsBody = document.createElement('tbody');
    (q.options || []).forEach((o) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      const labelInput = document.createElement('input');
      labelInput.className = 'menu-table-input';
      labelInput.type = 'text';
      labelInput.value = o.label;
      labelTd.appendChild(labelInput);

      const menuTd = document.createElement('td');
      const menuSelect = buildMenuSelect(o.menu_id);
      menuTd.appendChild(menuSelect);

      const actionTd = document.createElement('td');
      const saveOptBtn = document.createElement('button');
      saveOptBtn.className = 'btn btn--ghost';
      saveOptBtn.textContent = '保存';
      saveOptBtn.addEventListener('click', async () => {
        const label = labelInput.value.trim();
        if (!label) return;
        saveOptBtn.disabled = true;
        try {
          const res = await fetch(`/api/admin/quiz/options/${o.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, menuId: menuSelect.value }),
          });
          const data = await res.json();
          if (res.ok && data.ok) loadQuizQuestions();
        } finally {
          saveOptBtn.disabled = false;
        }
      });
      const deleteOptBtn = document.createElement('button');
      deleteOptBtn.className = 'btn btn--ghost';
      deleteOptBtn.textContent = '削除';
      deleteOptBtn.addEventListener('click', async () => {
        if (!window.confirm('この選択肢を削除しますか？')) return;
        await fetch(`/api/admin/quiz/options/${o.id}`, { method: 'DELETE' });
        loadQuizQuestions();
      });
      actionTd.append(saveOptBtn, deleteOptBtn);
      tr.append(labelTd, menuTd, actionTd);
      optionsBody.appendChild(tr);
    });
    optionsTable.appendChild(optionsBody);
    card.appendChild(optionsTable);

    const addOptionForm = document.createElement('form');
    addOptionForm.className = 'menu-add-form';
    addOptionForm.style.marginTop = '8px';
    const newLabelInput = document.createElement('input');
    newLabelInput.type = 'text';
    newLabelInput.placeholder = '選択肢のテキスト（例：伸びてきたので整えたい）';
    newLabelInput.required = true;
    newLabelInput.style.flex = '1';
    newLabelInput.style.minWidth = '200px';
    const newMenuSelect = buildMenuSelect(quizMenuCatalog[0] ? quizMenuCatalog[0].id : null);
    const addOptBtn = document.createElement('button');
    addOptBtn.type = 'submit';
    addOptBtn.className = 'btn btn--ghost';
    addOptBtn.textContent = '選択肢を追加';
    addOptionForm.append(newLabelInput, newMenuSelect, addOptBtn);
    addOptionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = newLabelInput.value.trim();
      if (!label) return;
      addOptBtn.disabled = true;
      try {
        const res = await fetch(`/api/admin/quiz/questions/${q.id}/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, menuId: newMenuSelect.value }),
        });
        const data = await res.json();
        if (res.ok && data.ok) loadQuizQuestions();
      } finally {
        addOptBtn.disabled = false;
      }
    });
    card.appendChild(addOptionForm);

    return card;
  }

  async function loadQuizQuestions() {
    const container = document.getElementById('quiz-questions');
    container.innerHTML = '';
    const res = await fetch('/api/admin/quiz');
    const data = await res.json();
    const questions = data.questions || [];
    if (!questions.length) {
      container.innerHTML = '<p class="empty-message">質問はまだありません。下のフォームから追加してください。</p>';
      return;
    }
    questions.forEach((q) => container.appendChild(renderQuizQuestionCard(q)));
  }

  async function initQuiz() {
    const res = await fetch('/api/admin/menus');
    const data = await res.json();
    quizMenuCatalog = (data.menus || []).filter((m) => Number(m.active) === 1);
    await loadQuizQuestions();

    document.getElementById('quiz-question-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('new-quiz-prompt');
      const message = document.getElementById('quiz-message');
      const prompt = input.value.trim();
      if (!prompt) return;
      try {
        const res2 = await fetch('/api/admin/quiz/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data2 = await res2.json();
        message.hidden = false;
        if (!res2.ok || !data2.ok) {
          message.textContent = '追加に失敗しました。';
          return;
        }
        message.textContent = '質問を追加しました。下に選択肢を追加してください。';
        input.value = '';
        loadQuizQuestions();
      } catch (err) {
        message.hidden = false;
        message.textContent = '通信エラーが発生しました。';
      }
    });
  }

  load();
  initStaffSlots();
  initSettings();
  initMenus();
  initStaffMenuAdjust();
  initStaffEmails();
  loadCustomers();
  initQuiz();
  loadCandidateRequests();
  loadWaitlistAlerts();
})();
