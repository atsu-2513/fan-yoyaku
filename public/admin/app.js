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
        confirmBtn.addEventListener('click', () => confirmReservation(r.id, confirmBtn));
        wrap.appendChild(confirmBtn);
      }
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn--ghost';
      cancelBtn.textContent = 'キャンセル';
      cancelBtn.addEventListener('click', () => cancelReservation(r.id, cancelBtn));
      wrap.appendChild(cancelBtn);
      actionTd.appendChild(wrap);
    }

    tr.append(statusTd, dateTd, staffTd, menuTd, nameTd, phoneTd, actionTd);
    return tr;
  }

  async function confirmReservation(id, btn) {
    btn.disabled = true;
    btn.textContent = '送信中...';
    try {
      const res = await fetch(`/api/admin/reservations/${id}/confirm`, { method: 'POST' });
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

  load();
  initStaffSlots();
})();
