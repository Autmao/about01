/* ===== routes/collaborators.js ===== */

const express = require('express');
const router = express.Router();
const { pool, genId, now, mapCollab, mapApp, getMemberNote } = require('../db');
const { decorateApplicationFiles } = require('../lib/storage');

/* GET /api/collaborators */
router.get('/', async (req, res) => {
  try {
    const { keyword, category, sortBy } = req.query;
    let q = `SELECT * FROM collaborators WHERE 1=1`;
    const params = [];

    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      q += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(internal_tags::text) LIKE $${params.length})`;
    }
    if (category) {
      params.push(`%"${category}"%`);
      q += ` AND categories::text LIKE $${params.length}`;
    }

    if (sortBy === 'rating') {
      q += ` ORDER BY rating DESC, updated_at DESC`;
    } else {
      q += ` ORDER BY updated_at DESC`;
    }

    const { rows } = await pool.query(q, params);
    res.json(rows.map(mapCollab));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/collaborators/:id */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM collaborators WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapCollab(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/collaborators/:id/activity — 成员备注 + 操作记录聚合 */
router.get('/:id/activity', async (req, res) => {
  try {
    const { rows: collabRows } = await pool.query('SELECT * FROM collaborators WHERE id = $1', [req.params.id]);
    if (!collabRows[0]) return res.status(404).json({ error: 'Not found' });
    const email = collabRows[0].email;

    // 查该邮箱所有投递。档案详情里的材料、备注和投递历史均以投递记录为准。
    const { rows: appRows } = await pool.query(
      `SELECT * FROM applications
       WHERE LOWER(email) = LOWER($1)
       ORDER BY submitted_at DESC`,
      [email]
    );

    const applications = [];
    const sharedNotes = [];
    const myNotes = [];
    for (const app of appRows) {
      const mapped = decorateApplicationFiles(mapApp(app));
      applications.push({
        id: mapped.id,
        jobId: mapped.jobId,
        jobTitle: mapped.jobTitle,
        jobCategory: mapped.jobCategory,
        status: mapped.status,
        portfolioLinks: mapped.portfolioLinks || [],
        resumeUrl: mapped.resumeUrl || '',
        portfolioFiles: mapped.portfolioFiles || [],
        submittedAt: mapped.submittedAt,
        updatedAt: mapped.updatedAt,
      });

      if (app.admin_note) {
        sharedNotes.push({
          note: app.admin_note,
          updatedAt: app.updated_at,
        });
      }

      const ownNote = await getMemberNote(req.adminUser.id, app.id);
      if (ownNote.note) {
        myNotes.push({
          note: ownNote.note,
          updatedAt: ownNote.updatedAt || app.updated_at,
        });
      }
    }

    // 聚合操作记录（有 actor 的 status_history 条目）
    const actionLog = [];
    for (const app of appRows) {
      const history = Array.isArray(app.status_history)
        ? app.status_history
        : JSON.parse(app.status_history || '[]');
      for (const h of history) {
        if (!h.actor) continue;
        if (h.from === h.to && h.action !== 'archived') continue;
        actionLog.push({
          jobTitle: app.job_title,
          actor: h.actor,
          action: h.action || null,
          from: h.from,
          to: h.to,
          at: h.at,
        });
      }
    }
    actionLog.sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({
      applications,
      sharedNotes,
      myNotes,
      memberNotes: [],
      actionLog,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/collaborators/from-app/:appId */
router.post('/from-app/:appId', async (req, res) => {
  try {
    const { rows: appRows } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.appId]);
    if (!appRows[0]) return res.status(404).json({ error: 'Application not found' });

    const app = appRows[0];
    const ts = now();
    const historyEntry = {
      jobId: app.job_id, jobTitle: app.job_title, status: 'hired', date: ts.slice(0, 7),
    };

    // 同邮箱已有档案 → 追加历史
    const { rows: existing } = await pool.query('SELECT * FROM collaborators WHERE email = $1', [app.email]);
    if (existing[0]) {
      const c = mapCollab(existing[0]);
      const history = c.cooperationHistory || [];
      if (!history.find(h => h.jobId === app.job_id)) {
        history.push(historyEntry);
      }
      const { rows: updated } = await pool.query(
        `UPDATE collaborators SET cooperation_history = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
        [JSON.stringify(history), ts, existing[0].id]
      );
      return res.json(mapCollab(updated[0]));
    }

    // 新建档案
    const id = genId('collab');
    const categories = app.job_category ? JSON.stringify([app.job_category]) : '[]';
    const { rows } = await pool.query(
      `INSERT INTO collaborators (id,name,email,phone,wechat,categories,bio,portfolio_links,
        cooperation_history,rating,internal_tags,internal_note,source_app_id,added_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, app.name, app.email, app.phone, app.wechat || '',
       categories, app.bio || '', JSON.stringify(app.portfolio_links || []),
       JSON.stringify([historyEntry]),
       0, '[]', '', req.params.appId, ts, ts]
    );
    res.status(201).json(mapCollab(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT /api/collaborators/:id */
router.put('/:id', async (req, res) => {
  try {
    const allowed = ['rating','internalNote','bio','phone','wechat',
      'internalTags','cooperationHistory','categories','portfolioLinks'];
    const fieldMap = {
      rating: 'rating', internalNote: 'internal_note', bio: 'bio',
      phone: 'phone', wechat: 'wechat',
      internalTags: 'internal_tags', cooperationHistory: 'cooperation_history',
      categories: 'categories', portfolioLinks: 'portfolio_links',
    };
    const jsonFields = new Set(['internalTags','cooperationHistory','categories','portfolioLinks']);

    const setClauses = [];
    const params = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const col = fieldMap[key];
        const val = jsonFields.has(key) ? JSON.stringify(req.body[key]) : req.body[key];
        params.push(val);
        setClauses.push(`${col} = $${params.length}`);
      }
    }

    if (!setClauses.length) return res.status(400).json({ error: 'No valid fields to update' });

    params.push(now());
    setClauses.push(`updated_at = $${params.length}`);
    params.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE collaborators SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapCollab(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE /api/collaborators/:id */
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM collaborators WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
