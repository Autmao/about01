/* ===== routes/jobs.js ===== */

const express = require('express');
const router = express.Router();
const { pool, genId, now, mapJob, isPastDeadline, closeExpiredJobs } = require('../db');
const { requireAdmin } = require('../middleware/auth');

/* GET /api/jobs — 前台列表（排除 draft） */
router.get('/', async (req, res) => {
  try {
    await closeExpiredJobs();
    const { category, keyword, status } = req.query;
    let q = `SELECT * FROM jobs WHERE status != 'draft'`;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      q += ` AND status = $${params.length}`;
    } else if (!status) {
      q += ` AND status = 'open'`;
    }
    if (category && category !== 'all') {
      params.push(category);
      q += ` AND category = $${params.length}`;
    }
    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      q += ` AND (LOWER(title) LIKE $${params.length} OR tags::text ILIKE $${params.length})`;
    }

    q += ` ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, created_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows.map(mapJob));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/jobs/admin — 后台列表（含 draft） */
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    await closeExpiredJobs();
    const { status, keyword } = req.query;
    let q = `SELECT * FROM jobs WHERE 1=1`;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      q += ` AND status = $${params.length}`;
    }
    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      q += ` AND LOWER(title) LIKE $${params.length}`;
    }

    q += ` ORDER BY created_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows.map(mapJob));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/jobs/:id */
router.get('/:id', async (req, res) => {
  try {
    await closeExpiredJobs();
    const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapJob(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/jobs */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { title, category, status = 'draft', description, requirements = [],
      deliverables, fee, feeType = 'per_project', deadline,
      slots = 1, tags = [], coverColor = '#E8DDD0' } = req.body;

    if (!title || !category) return res.status(400).json({ error: 'title and category required' });
    if (status === 'open' && isPastDeadline(deadline)) {
      return res.status(400).json({ error: '截止日期已过，请调整日期后再开启招募' });
    }

    const id = genId('job');
    const ts = now();
    const publishedAt = status === 'open' ? ts : null;

    const { rows } = await pool.query(
      `INSERT INTO jobs (id,title,category,status,description,requirements,deliverables,
        fee,fee_type,deadline,slots,tags,cover_color,application_count,published_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [id, title, category, status, description,
       JSON.stringify(requirements), deliverables,
       fee, feeType, deadline || null, slots, JSON.stringify(tags), coverColor,
       0, publishedAt, ts, ts]
    );
    res.status(201).json(mapJob(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* PUT /api/jobs/:id */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const nextStatus = req.body.status !== undefined ? req.body.status : existing[0].status;
    const nextDeadline = req.body.deadline !== undefined ? req.body.deadline : existing[0].deadline;
    if (nextStatus === 'open' && isPastDeadline(nextDeadline)) {
      return res.status(400).json({ error: '截止日期已过，请调整日期后再开启招募' });
    }

    const ts = now();
    let publishedAt = existing[0].published_at;
    if (req.body.status === 'open' && !publishedAt) publishedAt = ts;

    const allowed = ['title','category','status','description','requirements','deliverables',
      'fee','feeType','deadline','slots','tags','coverColor'];
    const setClauses = [];
    const params = [];

    const fieldMap = {
      title: 'title', category: 'category', status: 'status', description: 'description',
      requirements: 'requirements', deliverables: 'deliverables', fee: 'fee',
      feeType: 'fee_type', deadline: 'deadline', slots: 'slots',
      tags: 'tags', coverColor: 'cover_color',
    };
    const jsonFields = new Set(['requirements', 'tags']);

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const col = fieldMap[key];
        const val = jsonFields.has(key) ? JSON.stringify(req.body[key]) : req.body[key];
        params.push(val);
        setClauses.push(`${col} = $${params.length}`);
      }
    }

    params.push(publishedAt);
    setClauses.push(`published_at = $${params.length}`);
    params.push(ts);
    setClauses.push(`updated_at = $${params.length}`);
    params.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json(mapJob(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE /api/jobs/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
