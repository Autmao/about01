/* ===== routes/auth.js ===== */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  getAdminUserByUsername, getAdminUserById,
  updateAdminUserPassword, mapAdminUser, listAdminUsers,
} = require('../db');
const { signToken, requireAdmin } = require('../middleware/auth');

/* POST /api/admin/login */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  try {
    const user = await getAdminUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ sub: user.id, username: user.username, displayName: user.display_name, role: user.role });
    res.json({ token, user: mapAdminUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/admin/logout */
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

/* GET /api/admin/me */
router.get('/me', requireAdmin, async (req, res) => {
  try {
    const user = await getAdminUserById(req.adminUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(mapAdminUser(user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/admin/team */
router.get('/team', requireAdmin, async (req, res) => {
  try {
    const users = await listAdminUsers();
    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/admin/me/password */
router.patch('/me/password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少6位' });
  }
  try {
    const user = await getAdminUserById(req.adminUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: '当前密码不正确' });
    const hash = await bcrypt.hash(newPassword, 10);
    await updateAdminUserPassword(req.adminUser.id, hash);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router };
