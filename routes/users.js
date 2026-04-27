/* ===== routes/users.js — 投递者注册/登录/个人信息 ===== */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool, genId, now, mapApp,
  getUserByPhone, getUserById, createUser, updateUser,
  createPhoneOtp, verifyPhoneOtp } = require('../db');
const { sendSmsOtp } = require('../lib/sms');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

/* ── requireUser 中间件（导出供其他路由使用）── */
function requireUser(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'user') return res.status(401).json({ error: 'Invalid token type' });
    req.userId = payload.sub;
    req.userPhone = payload.phone;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

/* POST /api/users/send-otp */
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const code = await createPhoneOtp(phone);
    await sendSmsOtp(phone, code);
    res.json({ ok: true });
  } catch (e) {
    console.error('[users] send-otp error:', e.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

/* POST /api/users/verify-otp */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code, name, email } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });

    const valid = await verifyPhoneOtp(phone, code);
    if (!valid) return res.status(401).json({ error: 'Invalid or expired code' });

    let user = await getUserByPhone(phone);
    if (!user) {
      user = await createUser({ phone, name: name || '', email: email || '' });
    } else if (name || email) {
      const updates = {};
      if (name) updates.name = name;
      if (email) updates.email = email;
      user = await updateUser(user.id, updates);
    }

    const token = jwt.sign(
      { type: 'user', sub: user.id, phone: user.phone },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user: { id: user.id, phone: user.phone, name: user.name, email: user.email } });
  } catch (e) {
    console.error('[users] verify-otp error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/users/me */
router.get('/me', requireUser, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, phone: user.phone, name: user.name, email: user.email });
  } catch (e) {
    console.error('[users] me error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/users/me */
router.patch('/me', requireUser, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await updateUser(req.userId, { name, email });
    res.json({ id: user.id, phone: user.phone, name: user.name, email: user.email });
  } catch (e) {
    console.error('[users] patch me error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/users/me/applications */
router.get('/me/applications', requireUser, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, job_title, job_category, status, submitted_at, updated_at
       FROM applications WHERE user_id = $1 ORDER BY submitted_at DESC`,
      [req.userId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      jobTitle: r.job_title,
      jobCategory: r.job_category,
      status: r.status,
      submittedAt: r.submitted_at,
      updatedAt: r.updated_at,
    })));
  } catch (e) {
    console.error('[users] me/applications error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.requireUser = requireUser;
