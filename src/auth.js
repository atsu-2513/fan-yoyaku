const crypto = require('crypto');

// スタッフ用ログインのパスワードハッシュ化 & セッションCookieの署名。
// 追加npmパッケージなしで実装するため、Node標準の crypto のみを使用している。

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[auth] SESSION_SECRET が未設定です。本番環境では必ず設定してください。');
}

const SESSION_COOKIE = 'fan_staff_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日間ログイン維持

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function createSessionCookie(staffId) {
  const token = sign({ staffId, exp: Date.now() + SESSION_TTL_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}; SameSite=Lax${secure}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function getStaffIdFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const data = verifyToken(token);
  if (!data || !data.exp || data.exp < Date.now()) return null;
  return data.staffId;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  getStaffIdFromRequest,
};
