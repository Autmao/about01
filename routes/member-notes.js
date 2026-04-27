/* ===== routes/member-notes.js ===== */

const express = require('express');
const router = express.Router();
const { getMemberNote, upsertMemberNote, getAllMemberNotesByAppId } = require('../db');

/* 所有路由由 server.js 挂载时的 requireAdmin 保护 */

/* GET /api/admin/notes/:appId */
router.get('/:appId', async (req, res) => {
  try {
    const result = await getMemberNote(req.adminUser.id, req.params.appId);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/admin/notes/:appId/all — 返回该投递所有成员的备注 */
router.get('/:appId/all', async (req, res) => {
  try {
    const notes = await getAllMemberNotesByAppId(req.params.appId);
    res.json(notes);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT /api/admin/notes/:appId */
router.put('/:appId', async (req, res) => {
  const { note = '' } = req.body;
  try {
    await upsertMemberNote(req.adminUser.id, req.params.appId, note);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
