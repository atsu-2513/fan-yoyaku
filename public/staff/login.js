(function () {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.hidden = true;

    const form = e.target;
    const username = form.username.value.trim();
    const password = form.password.value;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/staff/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        errorEl.textContent = 'IDまたはパスワードが違います。';
        errorEl.hidden = false;
        submitBtn.disabled = false;
        return;
      }
      window.location.href = '/staff/';
    } catch (err) {
      errorEl.textContent = '通信エラーが発生しました。もう一度お試しください。';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
})();
