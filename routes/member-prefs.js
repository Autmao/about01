/* ===== routes/member-prefs.js ===== */

const express = require('express');
const router = express.Router();
const { getMemberPreferences, upsertMemberPreferences } = require('../db');

/* 所有路由由 server.js 挂载时的 requireAdmin 保护 */

/* GET /api/admin/preferences */
router.get('/', async (req, res) => {
  try {
    const prefs = await getMemberPreferences(req.adminUser.id);
    res.json(prefs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT /api/admin/preferences */
router.put('/', async (req, res) => {
  const preferences = req.body;
  if (typeof preferences !== 'object' || Array.isArray(preferences)) {
    return res.status(400).json({ error: 'preferences must be a JSON object' });
  }
  try {
    await upsertMemberPreferences(req.adminUser.id, preferences);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
