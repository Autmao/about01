/* ===== routes/stats.js ===== */

const express = require('express');
const router = express.Router();
const { pool, seedDemoData, closeExpiredJobs } = require('../db');
// Note: requireAdmin is applied at server.js mount level for this router

/* GET /api/stats */
router.get('/stats', async (req, res) => {
  try {
    await closeExpiredJobs();
    const thisMonth = new Date().toISOString().slice(0, 7);

    const [jobs, apps, collabs] = await Promise.all([
      pool.query(`SELECT status FROM jobs`),
      pool.query(`SELECT status, submitted_at FROM applications`),
      pool.query(`SELECT COUNT(*) FROM collaborators`),
    ]);

    const openJobs    = jobs.rows.filter(j => j.status === 'open').length;
    const totalApps   = apps.rows.length;
    const pendingApps = apps.rows.filter(a => a.status === 'pending').length;
    const hiredTotal  = apps.rows.filter(a => a.status === 'hired').length;
    const monthlyApps = apps.rows.filter(a => String(a.submitted_at).slice(0, 7) === thisMonth).length;

    res.json({
      openJobs, totalApps, pendingApps, hiredTotal, monthlyApps,
      collaborators: parseInt(collabs.rows[0].count),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/seed — 仅限非生产环境 */
router.post('/seed', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Seed not available in production' });
  }
  try {
    res.json(await seedDemoData());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
