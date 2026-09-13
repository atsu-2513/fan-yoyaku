const express = require('express');
const {
  getValidShopToken,
  markShopTokenUsed,
  listActiveShopProducts,
  listShopCategories,
  findStaffIdForPhone,
  createShopOrder,
  getStaffById,
} = require('../db');
const { pushText } = require('../line');
const { sendMail } = require('../mail');

const router = express.Router();

// トークンが有効か確認し、あわせて公開中の商品一覧を返す(店販ページ読み込み時に使用)
router.get('/api/shop/token/:token', async (req, res) => {
  const row = await getValidShopToken(req.params.token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
  const [products, categories] = await Promise.all([listActiveShopProducts(), listShopCategories()]);
  res.json({ ok: true, products, categories });
});

// 注文リクエストの送信
router.post('/api/shop/orders', async (req, res) => {
  const { token, name, phone, items } = req.body || {};

  const row = await getValidShopToken(token);
  if (!row) return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
  const phonePattern = /^[0-9-]{9,14}$/;
  if (!trimmedName) return res.status(400).json({ ok: false, error: 'name_required' });
  if (!phonePattern.test(trimmedPhone)) return res.status(400).json({ ok: false, error: 'invalid_phone' });

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'items_required' });
  }

  // お客様が選んだ時点の商品情報(名前・価格)をそのまま注文記録として保存する
  // (あとで商品が編集・削除されても、過去の注文内容が変わらないようにするため)
  const activeProducts = await listActiveShopProducts();
  const productMap = new Map(activeProducts.map((p) => [String(p.id), p]));
  const orderItems = [];
  for (const item of items) {
    const product = productMap.get(String(item && item.productId));
    const quantity = Number(item && item.quantity);
    if (!product || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
      return res.status(400).json({ ok: false, error: 'invalid_item' });
    }
    orderItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: Math.floor(quantity),
    });
  }
  const totalPrice = orderItems.reduce(
    (sum, it) => sum + (Number.isFinite(it.price) ? it.price * it.quantity : 0),
    0
  );

  const staffId = await findStaffIdForPhone(trimmedPhone);

  const order = await createShopOrder({
    lineUserId: row.line_user_id,
    staffId,
    customerName: trimmedName,
    phone: trimmedPhone,
    items: orderItems,
    totalPrice,
  });
  await markShopTokenUsed(token);

  const itemsText = orderItems.map((it) => `・${it.name} × ${it.quantity}`).join('\n');

  try {
    await pushText(
      row.line_user_id,
      `${trimmedName}様\nご注文を受け付けました。\n\n${itemsText}\n\n店舗からのご連絡をお待ちください。`
    );
  } catch (err) {
    console.error('LINE push (店販注文) failed:', err);
  }

  try {
    let staffName = '(担当未特定)';
    let staffEmail = null;
    if (staffId) {
      const staff = await getStaffById(staffId);
      if (staff) {
        staffName = staff.name;
        staffEmail = staff.email;
      }
    }
    const recipients = [staffEmail, process.env.OWNER_EMAIL].filter(Boolean);
    if (recipients.length) {
      await sendMail({
        to: recipients,
        subject: `【店販注文】${trimmedName}様`,
        text:
          `店販商品の注文リクエストが届きました。\n\n` +
          `お名前: ${trimmedName}\n` +
          `電話番号: ${trimmedPhone}\n` +
          `担当: ${staffName}\n\n` +
          `注文内容:\n${itemsText}\n` +
          (Number.isFinite(totalPrice) && totalPrice > 0 ? `\n合計: ${totalPrice}円\n` : '') +
          (process.env.BASE_URL ? `\n管理画面で確認: ${process.env.BASE_URL}/admin/` : ''),
      });
    }
  } catch (err) {
    console.error('メール通知(店販注文)の送信に失敗しました:', err);
  }

  res.json({ ok: true, order });
});

module.exports = router;
