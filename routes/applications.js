/* ===== routes/applications.js ===== */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool, genId, now, mapApp, mapCollab,
  isPastDeadline, closeExpiredJobs } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendStatusEmail } = require('../lib/mailer');
const { decorateApplicationFiles } = require('../lib/storage');

const MAX_TOTAL_UPLOAD_SIZE = 50 * 1024 * 1024;
const MAX_BIO_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 160;

function getSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret';
}

function getApplicantPayload(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getSecret());
    return payload.type === 'applicant' && payload.email ? payload : null;
  } catch {
    return null;
  }
}

function requireApplicant(req, res, next) {
  const payload = getApplicantPayload(req);
  if (!payload) return res.status(401).json({ error: 'Applicant login required' });
  req.applicantEmail = String(payload.email).toLowerCase().trim();
  next();
}

function normalizeUploadedFile(file) {
  if (!file || typeof file !== 'object') return null;
  const url = String(file.url || '').trim();
  const size = Number(file.size);
  if (!url.startsWith('oss://') || !Number.isFinite(size) || size <= 0) return null;
  const name = String(file.name || '未命名材料')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH) || '未命名材料';
  return { name, size, url };
}

function normalizePortfolioLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map((link, index) => {
      const url = String(link?.url || '').trim();
      if (!url) return null;
      const rawIndex = Number(link?.index);
      return {
        url,
        label: String(link?.label || `作品链接 ${index + 1}`).trim(),
        index: Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : index + 1,
      };
    })
    .filter(Boolean);
}

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
    res.json(rows.map(row => decorateApplicationFiles(mapApp(row))));
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

/* GET /api/applications/my — 创作伙伴登录后查询自己的投递状态 */
router.get('/my', requireApplicant, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, job_id, job_title, job_category, status, submitted_at, updated_at
       FROM applications
       WHERE LOWER(email) = $1
       ORDER BY submitted_at DESC`,
      [req.applicantEmail]
    );
    res.json(rows.map(r => ({
      id: r.id,
      jobId: r.job_id,
      jobTitle: r.job_title,
      jobCategory: r.job_category,
      status: r.status,
      submittedAt: r.submitted_at,
      updatedAt: r.updated_at,
    })));
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
    res.json(decorateApplicationFiles(mapApp(rows[0])));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/applications — 创作伙伴登录后提交 */
router.post('/', requireApplicant, async (req, res) => {
  try {
    await closeExpiredJobs();
    const { jobId, name = '', email = '', phone = '', wechat = '', bio = '',
      portfolioNote = '', portfolioLinks = [],
      resumeUrl = '', portfolioFiles = [] } = req.body;

    if (!jobId) return res.status(400).json({ error: 'jobId required' });

    const normalizedName = String(name).trim();
    const normalizedEmail = req.applicantEmail;
    const submittedEmail = String(email || '').toLowerCase().trim();
    const normalizedPhone = String(phone).trim();
    const normalizedBio = String(bio || '').trim();
    const rawPortfolioFiles = Array.isArray(portfolioFiles) ? portfolioFiles : [];
    const normalizedPortfolioFiles = rawPortfolioFiles.map(normalizeUploadedFile).filter(Boolean);
    const normalizedPortfolioLinks = normalizePortfolioLinks(portfolioLinks);
    const totalUploadSize = normalizedPortfolioFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
    if (!normalizedName) return res.status(400).json({ error: 'name required' });
    if (submittedEmail && submittedEmail !== normalizedEmail) {
      return res.status(403).json({ error: 'email must match logged in applicant' });
    }
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'valid phone required' });
    }
    if (!normalizedBio || normalizedBio.length > MAX_BIO_LENGTH) {
      return res.status(400).json({ error: 'bio required and max 200 chars' });
    }
    if (!rawPortfolioFiles.length) {
      return res.status(400).json({ error: 'resume and portfolio materials required' });
    }
    if (normalizedPortfolioFiles.length !== rawPortfolioFiles.length) {
      return res.status(400).json({ error: 'valid uploaded files required' });
    }
    if (totalUploadSize > MAX_TOTAL_UPLOAD_SIZE) {
      return res.status(400).json({ error: 'uploaded files exceed 50MB total' });
    }

    // 防重复投递（登录邮箱或手机号）
    const { rows: dupRows } = await pool.query(
      `SELECT id FROM applications
       WHERE job_id = $1
         AND (LOWER(email) = $2 OR phone = $3)`,
      [jobId, normalizedEmail, normalizedPhone]
    );
    if (dupRows[0]) return res.status(409).json({ error: 'Already applied', appId: dupRows[0].id });

    // 检查职位存在且仍可投递
    const { rows: jobRows } = await pool.query('SELECT title, category, status, deadline FROM jobs WHERE id = $1', [jobId]);
    if (!jobRows[0]) return res.status(404).json({ error: 'Job not found' });
    if (jobRows[0].status !== 'open' || isPastDeadline(jobRows[0].deadline)) {
      return res.status(400).json({ error: '该岗位已截止，暂不接受新的投递' });
    }

    const ts = now();
    const id = genId('app');
    const history = JSON.stringify([{ from: null, to: 'pending', at: ts, note: '' }]);

    const { rows } = await pool.query(
      `INSERT INTO applications (id,job_id,job_title,job_category,name,email,phone,wechat,
        bio,portfolio_note,portfolio_links,resume_url,portfolio_files,
        status,status_history,admin_note,user_id,submitted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [id, jobId, jobRows[0].title, jobRows[0].category,
       normalizedName, normalizedEmail, normalizedPhone, wechat, normalizedBio, portfolioNote, JSON.stringify(normalizedPortfolioLinks),
       normalizedPortfolioFiles[0]?.url || '', JSON.stringify(normalizedPortfolioFiles),
       'pending', history, '', null, ts, ts]
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
    const { status, note = '', emailSubject = '', emailBody = '' } = req.body;
    if (!['pending','read','hired','rejected'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const { rows: existing } = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const ts = now();
    const app = mapApp(existing[0]);
    const finalStatuses = new Set(['hired', 'rejected']);
    if (finalStatuses.has(app.status) && status !== app.status) {
      return res.status(409).json({ error: 'Final decision cannot be changed' });
    }
    if (app.status === status) return res.json(decorateApplicationFiles(app));

    const actor = req.adminUser.displayName || req.adminUser.username || '';
    const history = [...(app.statusHistory || []), { from: app.status, to: status, at: ts, note, actor }];

    const { rows } = await pool.query(
      `UPDATE applications SET status = $1, status_history = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
      [status, JSON.stringify(history), ts, req.params.id]
    );

    // 只有最终结果才发邮件；已读/待处理是后台内部状态。
    if (status === 'hired' || status === 'rejected') {
      await sendStatusEmail(app.email, app.name, app.jobTitle, status, {
        subject: emailSubject,
        body: emailBody,
      });
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
