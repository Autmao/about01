/* ===== routes/auth.js ===== */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// 用 ADMIN_PASSWORD 对固定字符串做 HMAC 签名，生成无状态 token
// 无需内存存储，serverless 冷启动后仍然有效
function makeToken(password) {
  return crypto.createHmac('sha256', password).update('admin-token').digest('hex');
}

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

  res.json({ token: makeToken(adminPassword) });
});

/* POST /api/admin/logout */
router.post('/logout', (req, res) => {
  // 无状态 token 无需服务端清除，客户端删除即可
  res.json({ ok: true });
});

module.exports = { router, makeToken };
