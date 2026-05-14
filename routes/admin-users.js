/* ===== routes/admin-users.js ===== */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  listAdminUsers, createAdminUser, deleteAdminUser,
  updateAdminUserPassword, updateAdminUserNotificationEmail, getAdminUserById,
} = require('../db');

/* 所有路由由 server.js 挂载时的 requireSuperAdmin 保护 */

/* GET /api/admin-users */
router.get('/', async (req, res) => {
  try {
    res.json(await listAdminUsers());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/admin-users */
router.post('/', async (req, res) => {
  const { username, displayName, notificationEmail = '', password, role = 'member' } = req.body;
  const normalizedEmail = String(notificationEmail).toLowerCase().trim();
  if (!username || !password) {
    return res.status(400).json({ error: '登录账号和密码不能为空' });
  }
  if (!/^1[3-9]\d{9}$/.test(username)) {
    return res.status(400).json({ error: '登录账号请填写有效的11位手机号' });
  }
  if (!displayName) {
    return res.status(400).json({ error: '用户名不能为空' });
  }
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: '请填写有效的通知邮箱' });
  }
  if (!['member', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createAdminUser({ username, displayName, notificationEmail: normalizedEmail, role, passwordHash });
    res.status(201).json(user);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: '登录账号或通知邮箱已存在' });
    }
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/admin-users/:id/notification-email */
router.patch('/:id/notification-email', async (req, res) => {
  const notificationEmail = String(req.body.notificationEmail || '').toLowerCase().trim();
  if (!notificationEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
    return res.status(400).json({ error: '请填写有效的通知邮箱' });
  }
  try {
    const user = await getAdminUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const updated = await updateAdminUserNotificationEmail(req.params.id, notificationEmail);
    res.json(updated);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: '该邮箱已绑定其他账号' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE /api/admin-users/:id */
router.delete('/:id', async (req, res) => {
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }
  try {
    const ok = await deleteAdminUser(req.params.id);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/admin-users/:id/password */
router.patch('/:id/password', async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少6位' });
  }
  try {
    const user = await getAdminUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const hash = await bcrypt.hash(newPassword, 10);
    await updateAdminUserPassword(req.params.id, hash);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
