/* ===== routes/auth.js ===== */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// 存储有效 token（内存），重启后失效（需重新登录）
const validTokens = new Set();

/* POST /api/admin/login */
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({ error: 'Server misconfigured: ADMIN_PASSWORD not set' });
  }
  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  res.json({ token });
});

/* POST /api/admin/logout */
router.post('/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) validTokens.delete(token);
  res.json({ ok: true });
});

module.exports = { router, validTokens };
