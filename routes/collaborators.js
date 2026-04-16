/* ===== routes/collaborators.js ===== */

const express = require('express');
const router = express.Router();
const { pool, genId, now, mapCollab } = require('../db');

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
