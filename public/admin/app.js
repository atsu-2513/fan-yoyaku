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
    badge.textContent = r.status === 'confirmed' ? '確定' : '仮予約';
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
    if (r.status === 'confirmed') {
      actionTd.textContent = '—';
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '確定する';
      btn.addEventListener('click', () => confirmReservation(r.id, btn));
      actionTd.appendChild(btn);
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

  document.getElementById('refresh').addEventListener('click', load);

  load();
})();
