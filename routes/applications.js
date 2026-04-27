/* ===== routes/applications.js ===== */

const express = require('express');
const router = express.Router();
const { pool, genId, now, mapApp, mapCollab, getUserById } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { requireUser } = require('./users');
const { sendStatusEmail } = require('../lib/mailer');

/* GET /api/applications */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { jobId, status, keyword, email } = req.query;
    let q = `SELECT * FROM applications WHERE 1=1`;
    const params = [];

    if (jobId) {
      params.push(jobId);
      q += ` AND job_id = $${params.length}`;
    }
    if (email) {
      params.push(email);
      q += ` AND email = $${params.length}`;
    }
    if (status && status !== 'all') {
      params.push(status);
      q += ` AND status = $${params.length}`;
    }
    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      q += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
    }

    q += ` ORDER BY submitted_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows.map(mapApp));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/applications/counts */
router.get('/counts', requireAdmin, async (req, res) => {
  try {
    const { jobId } = req.query;
    let q = `SELECT status, COUNT(*) FROM applications`;
    const params = [];
    if (jobId) { params.push(jobId); q += ` WHERE job_id = $1`; }
    q += ` GROUP BY status`;

    const { rows } = await pool.query(q, params);
    const counts = { all: 0, pending: 0, read: 0, hired: 0, rejected: 0 };
    for (const r of rows) {
      const s = r.status;
      const n = parseInt(r.count);
      counts.all += n;
      if (s in counts) counts[s] = n;
    }
    res.json(counts);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/applications/my?email=... — 公开接口，投递者查询自己的投递状态 */
router.get('/my', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });
    const { rows } = await pool.query(
      `SELECT job_title, status FROM applications WHERE email = $1 ORDER BY submitted_at DESC`,
      [email.toLowerCase().trim()]
    );
    res.json(rows.map(r => ({ jobTitle: r.job_title, status: r.status })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/applications/:id */
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapApp(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/applications — 需登录 */
router.post('/', requireUser, async (req, res) => {
  try {
    const { jobId, wechat = '', bio = '',
      portfolioNote = '', portfolioLinks = [],
      resumeUrl = '', portfolioFiles = [] } = req.body;

    if (!jobId) return res.status(400).json({ error: 'jobId required' });

    // 从已登录用户资料获取姓名/手机
    const user = await getUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const name = req.body.name || user.name || '';
    const phone = user.phone;
    const email = req.body.email || user.email || '';

    // 防重复投递（按 user_id）
    const { rows: dupRows } = await pool.query(
      'SELECT id FROM applications WHERE job_id = $1 AND user_id = $2',
      [jobId, req.userId]
    );
    if (dupRows[0]) return res.status(409).json({ error: 'Already applied', appId: dupRows[0].id });

    // 检查职位存在
    const { rows: jobRows } = await pool.query('SELECT title, category FROM jobs WHERE id = $1', [jobId]);
    if (!jobRows[0]) return res.status(404).json({ error: 'Job not found' });

    const ts = now();
    const id = genId('app');
    const history = JSON.stringify([{ from: null, to: 'pending', at: ts, note: '' }]);

    const { rows } = await pool.query(
      `INSERT INTO applications (id,job_id,job_title,job_category,name,email,phone,wechat,
        bio,portfolio_note,portfolio_links,resume_url,portfolio_files,
        status,status_history,admin_note,user_id,submitted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [id, jobId, jobRows[0].title, jobRows[0].category,
       name, email, phone, wechat, bio, portfolioNote, JSON.stringify(portfolioLinks),
       resumeUrl, JSON.stringify(portfolioFiles),
       'pending', history, '', req.userId, ts, ts]
    );

    await pool.query(
      'UPDATE jobs SET application_count = application_count + 1, updated_at = $1 WHERE id = $2',
      [ts, jobId]
    );

    res.status(201).json(mapApp(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/applications/:id/status */
router.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status, note = '' } = req.body;
    if (!['pending','read','hired','rejected'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const { rows: existing } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const ts = now();
    const app = mapApp(existing[0]);
    const actor = req.adminUser.displayName || req.adminUser.username || '';
    const history = [...(app.statusHistory || []), { from: app.status, to: status, at: ts, note, actor }];

    const { rows } = await pool.query(
      `UPDATE applications SET status = $1, status_history = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
      [status, JSON.stringify(history), ts, req.params.id]
    );

    // 录用或婉拒时发邮件通知候选人（await 确保 serverless 函数退出前完成）
    if (status === 'hired' || status === 'rejected') {
      await sendStatusEmail(app.email, app.name, app.jobTitle, status);
    }

    res.json(mapApp(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/applications/:id/archive — 加入合作者档案（独立操作，不影响 status） */
router.post('/:id/archive', requireAdmin, async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const ts = now();
    const app = mapApp(existing[0]);
    const actor = req.adminUser.displayName || req.adminUser.username || '';

    // 在 status_history 里追加一条 archive 操作记录
    const history = [...(app.statusHistory || []), {
      from: app.status, to: app.status, at: ts, note: '', actor, action: 'archived',
    }];

    await pool.query(
      `UPDATE applications SET status_history = $1, updated_at = $2 WHERE id = $3`,
      [JSON.stringify(history), ts, req.params.id]
    );

    // 创建或更新合作者档案
    const historyEntry = {
      jobId: app.jobId, jobTitle: app.jobTitle, status: app.status, date: ts.slice(0, 7),
    };
    const { rows: existing_collab } = await pool.query(
      'SELECT * FROM collaborators WHERE email = $1', [app.email]
    );

    let collab;
    if (existing_collab[0]) {
      const c = existing_collab[0];
      const cHistory = Array.isArray(c.cooperation_history) ? c.cooperation_history : JSON.parse(c.cooperation_history || '[]');
      if (!cHistory.find(h => h.jobId === app.jobId)) cHistory.push(historyEntry);
      const { rows: updated } = await pool.query(
        `UPDATE collaborators SET cooperation_history = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
        [JSON.stringify(cHistory), ts, c.id]
      );
      collab = updated[0];
    } else {
      const id = genId('collab');
      const categories = app.jobCategory ? JSON.stringify([app.jobCategory]) : '[]';
      const { rows: inserted } = await pool.query(
        `INSERT INTO collaborators (id,name,email,phone,wechat,categories,bio,portfolio_links,
          cooperation_history,rating,internal_tags,internal_note,source_app_id,added_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [id, app.name, app.email, app.phone, app.wechat || '',
         categories, app.bio || '', JSON.stringify(app.portfolioLinks || []),
         JSON.stringify([historyEntry]),
         0, '[]', '', req.params.id, ts, ts]
      );
      collab = inserted[0];
    }

    res.json({ ok: true, collabId: collab?.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PATCH /api/applications/:id/note */
router.patch('/:id/note', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE applications SET admin_note = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
      [req.body.note || '', now(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapApp(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
