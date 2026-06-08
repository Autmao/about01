/* ===== routes/jobs.js ===== */

const express = require('express');
const router = express.Router();
const { pool, genId, now, mapJob, isPastDeadline, closeExpiredJobs } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const DEPARTMENT_COLORS = {
  'about出版物': '#C9D4BE',
  'about热水频道': '#DDB37C',
  'about/CCC': '#B8C9DD',
};

function coverColorForDepartment(department, fallback = '#E8DDD0') {
  return DEPARTMENT_COLORS[department] || fallback || '#E8DDD0';
}

function mapAdminJob(row) {
  return {
    ...mapJob(row),
    ownerAdminId: row.owner_admin_id || '',
    ownerAdminName: row.owner_admin_name || '',
    ownerAdminUsername: row.owner_admin_username || '',
  };
}

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
      const categories = category === 'photo_video' ? ['photo_video', 'photography'] : [category];
      params.push(categories);
      q += ` AND category = ANY($${params.length})`;
    }
    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      q += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(COALESCE(description,'')) LIKE $${params.length} OR LOWER(COALESCE(department,'')) LIKE $${params.length} OR tags::text ILIKE $${params.length})`;
    }

    q += ` ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, display_order ASC NULLS LAST, created_at DESC`;
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
    let q = `SELECT j.*, COALESCE(au.display_name, NULLIF(j.owner_admin_id, '')) AS owner_admin_name, au.username AS owner_admin_username
             FROM jobs j
             LEFT JOIN admin_users au ON au.id = j.owner_admin_id
             WHERE 1=1`;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      q += ` AND j.status = $${params.length}`;
    }
    if (keyword) {
      params.push(`%${keyword.toLowerCase()}%`);
      q += ` AND (LOWER(j.title) LIKE $${params.length} OR LOWER(COALESCE(j.description,'')) LIKE $${params.length} OR LOWER(COALESCE(j.department,'')) LIKE $${params.length} OR j.tags::text ILIKE $${params.length})`;
    }

    q += ` ORDER BY j.display_order ASC NULLS LAST, j.created_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows.map(mapAdminJob));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/jobs/admin/:id — 后台详情（含负责人） */
router.get('/admin/:id', requireAdmin, async (req, res) => {
  try {
    await closeExpiredJobs();
    const { rows } = await pool.query(
      `SELECT j.*, COALESCE(au.display_name, NULLIF(j.owner_admin_id, '')) AS owner_admin_name, au.username AS owner_admin_username
       FROM jobs j
       LEFT JOIN admin_users au ON au.id = j.owner_admin_id
       WHERE j.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapAdminJob(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/jobs/:id */
router.get('/:id', async (req, res) => {
  try {
    await closeExpiredJobs();
    const { rows } = await pool.query(
      `SELECT * FROM jobs
       WHERE id = $1 AND status != 'draft'`,
      [req.params.id]
    );
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
    const { title, department = '', category, status = 'draft', description, requirements = [],
      deliverables, fee, feeType = 'per_project', deadline,
      slots = 1, tags = [], coverColor = '#E8DDD0' } = req.body;

    if (!title || !category) return res.status(400).json({ error: 'title and category required' });
    if (status === 'open' && isPastDeadline(deadline)) {
      return res.status(400).json({ error: '截止日期已过，请调整日期后再开启招募' });
    }

    const id = genId('job');
    const ts = now();
    const publishedAt = status === 'open' ? ts : null;
    const ownerAdminId = req.adminUser.role === 'superadmin' && req.body.ownerAdminId
      ? req.body.ownerAdminId
      : req.adminUser.id;
    const resolvedCoverColor = coverColorForDepartment(department, coverColor);
    const displayOrder = Number.isFinite(Number(req.body.displayOrder))
      ? Number(req.body.displayOrder)
      : -Date.now();

    const { rows } = await pool.query(
      `INSERT INTO jobs (id,title,category,department,status,description,requirements,deliverables,
        fee,fee_type,deadline,slots,tags,cover_color,owner_admin_id,display_order,application_count,published_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [id, title, category, department, status, description,
       JSON.stringify(requirements), deliverables,
       fee, feeType, deadline || null, slots, JSON.stringify(tags), resolvedCoverColor,
       ownerAdminId, displayOrder, 0, publishedAt, ts, ts]
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

    const body = { ...req.body };
    if (body.department !== undefined && body.coverColor === undefined) {
      body.coverColor = coverColorForDepartment(body.department, existing[0].cover_color);
    }

    const allowed = ['title','department','category','status','description','requirements','deliverables',
      'fee','feeType','deadline','slots','tags','coverColor','displayOrder'];
    if (req.adminUser.role === 'superadmin') allowed.push('ownerAdminId');
    const setClauses = [];
    const params = [];

    const fieldMap = {
      title: 'title', department: 'department', category: 'category', status: 'status', description: 'description',
      requirements: 'requirements', deliverables: 'deliverables', fee: 'fee',
      feeType: 'fee_type', deadline: 'deadline', slots: 'slots',
      tags: 'tags', coverColor: 'cover_color', ownerAdminId: 'owner_admin_id',
      displayOrder: 'display_order',
    };
    const jsonFields = new Set(['requirements', 'tags']);

    for (const key of allowed) {
      if (body[key] !== undefined) {
        const col = fieldMap[key];
        const val = jsonFields.has(key) ? JSON.stringify(body[key]) : body[key];
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

/* PATCH /api/jobs/:id/order — 调整前台显示顺序 */
router.patch('/:id/order', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await client.query('BEGIN');
    const { rows: jobs } = await client.query(
      `SELECT id
       FROM jobs
       ORDER BY display_order ASC NULLS LAST, created_at DESC`
    );
    const currentIndex = jobs.findIndex(job => job.id === req.params.id);
    if (currentIndex < 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= jobs.length) {
      await client.query('COMMIT');
      return res.json({ ok: true, unchanged: true });
    }

    const reordered = jobs.map(job => job.id);
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const ts = now();

    for (let i = 0; i < reordered.length; i++) {
      await client.query(
        'UPDATE jobs SET display_order = $1, updated_at = $2 WHERE id = $3',
        [(i + 1) * 1000, ts, reordered[i]]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
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
