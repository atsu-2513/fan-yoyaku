(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  const errorScreen = document.getElementById('error-screen');
  const listScreen = document.getElementById('list-screen');
  const formScreen = document.getElementById('form-screen');
  const doneScreen = document.getElementById('done-screen');

  const state = {
    token,
    products: [],
    quantities: {}, // { productId: qty }
  };

  function showScreen(el) {
    [errorScreen, listScreen, formScreen, doneScreen].forEach((s) => (s.hidden = s !== el));
  }

  async function init() {
    if (!token) {
      showScreen(errorScreen);
      return;
    }
    try {
      const res = await fetch(`/api/shop/token/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showScreen(errorScreen);
        return;
      }
      state.products = data.products || [];
      renderProductList();
      showScreen(listScreen);
    } catch (err) {
      showScreen(errorScreen);
    }
  }

  function formatPrice(price) {
    return Number.isFinite(Number(price)) && price !== null ? `${Number(price).toLocaleString()}円` : '価格はお問い合わせください';
  }

  function renderProductList() {
    const wrap = document.getElementById('product-list');
    const empty = document.getElementById('product-empty');
    wrap.innerHTML = '';
    empty.hidden = state.products.length > 0;

    state.products.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'product-card';

      if (p.photo_data) {
        const img = document.createElement('img');
        img.className = 'product-card__photo';
        img.src = p.photo_data;
        img.alt = p.name;
        card.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'product-card__photo product-card__photo--placeholder';
        ph.textContent = '画像なし';
        card.appendChild(ph);
      }

      const body = document.createElement('div');
      body.className = 'product-card__body';

      const name = document.createElement('div');
      name.className = 'product-card__name';
      name.textContent = p.name;
      body.appendChild(name);

      const price = document.createElement('div');
      price.className = 'product-card__price';
      price.textContent = formatPrice(p.price);
      body.appendChild(price);

      if (p.description) {
        const desc = document.createElement('div');
        desc.className = 'product-card__desc';
        desc.textContent = p.description;
        body.appendChild(desc);
      }

      const stepper = document.createElement('div');
      stepper.className = 'qty-stepper';
      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.textContent = '−';
      const qtyLabel = document.createElement('span');
      qtyLabel.textContent = '0';
      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.textContent = '＋';

      minusBtn.addEventListener('click', () => {
        const current = state.quantities[p.id] || 0;
        if (current <= 0) return;
        state.quantities[p.id] = current - 1;
        if (state.quantities[p.id] === 0) delete state.quantities[p.id];
        qtyLabel.textContent = String(state.quantities[p.id] || 0);
        updateCartBar();
      });
      plusBtn.addEventListener('click', () => {
        const current = state.quantities[p.id] || 0;
        if (current >= 99) return;
        state.quantities[p.id] = current + 1;
        qtyLabel.textContent = String(state.quantities[p.id]);
        updateCartBar();
      });

      stepper.appendChild(minusBtn);
      stepper.appendChild(qtyLabel);
      stepper.appendChild(plusBtn);
      body.appendChild(stepper);

      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  function getSelectedItems() {
    return Object.keys(state.quantities)
      .map((productId) => {
        const product = state.products.find((p) => String(p.id) === String(productId));
        const quantity = state.quantities[productId];
        if (!product || !quantity) return null;
        return { product, quantity };
      })
      .filter(Boolean);
  }

  function updateCartBar() {
    const bar = document.getElementById('cart-bar');
    const items = getSelectedItems();
    const count = items.reduce((sum, it) => sum + it.quantity, 0);
    const total = items.reduce(
      (sum, it) => sum + (Number.isFinite(Number(it.product.price)) ? Number(it.product.price) * it.quantity : 0),
      0
    );
    bar.hidden = count === 0;
    document.getElementById('cart-count').textContent = String(count);
    document.getElementById('cart-total').textContent = total.toLocaleString();
  }

  document.getElementById('go-to-form').addEventListener('click', () => {
    const items = getSelectedItems();
    if (items.length === 0) return;
    const summary = document.getElementById('order-summary');
    const total = items.reduce(
      (sum, it) => sum + (Number.isFinite(Number(it.product.price)) ? Number(it.product.price) * it.quantity : 0),
      0
    );
    summary.innerHTML =
      items.map((it) => `${it.product.name} × ${it.quantity}`).join('<br />') +
      (total > 0 ? `<br /><strong>合計: ${total.toLocaleString()}円</strong>` : '');
    showScreen(formScreen);
  });

  document.getElementById('back-to-list').addEventListener('click', () => {
    showScreen(listScreen);
  });

  document.getElementById('customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('submit-error');
    errorEl.hidden = true;

    const form = e.target;
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const items = getSelectedItems().map((it) => ({ productId: it.product.id, quantity: it.quantity }));
    if (items.length === 0) {
      showScreen(listScreen);
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = await fetch('/api/shop/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: state.token, name, phone, items }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        errorEl.hidden = false;
        errorEl.textContent =
          data.error === 'invalid_phone'
            ? '電話番号の形式をご確認ください。'
            : data.error === 'invalid_or_expired_token'
            ? 'リンクの有効期限が切れました。お手数ですがLINEでもう一度「店販」と送信してください。'
            : '送信に失敗しました。時間をおいて再度お試しください。';
        submitBtn.disabled = false;
        return;
      }
      showScreen(doneScreen);
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = '通信エラーが発生しました。';
      submitBtn.disabled = false;
    }
  });

  init();
})();
