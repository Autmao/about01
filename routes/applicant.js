/* ===== routes/applicant.js — 投递者公开接口 ===== */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool, createOtp, verifyOtp } = require('../db');
const { sendOtpEmail } = require('../lib/mailer');

function getSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret';
}

function requireApplicant(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.type !== 'applicant') return res.status(403).json({ error: 'Forbidden' });
    req.applicantEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

/* POST /api/applicant/send-otp
   body: { email }
   检查邮箱有投递记录后发送验证码 */
router.post('/send-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const { rows } = await pool.query(
      'SELECT id FROM applications WHERE email = $1 LIMIT 1',
      [email]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'no_record', message: '该邮箱暂无投递记录' });
    }

    const code = await createOtp(email);
    await sendOtpEmail(email, code);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/applicant/verify-otp
   body: { email, code }
   验证成功后签发 24h JWT */
router.post('/verify-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const code = (req.body.code || '').trim();
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });

    const ok = await verifyOtp(email, code);
    if (!ok) return res.status(401).json({ error: 'invalid_code', message: '验证码错误或已过期' });

    const token = jwt.sign({ type: 'applicant', email }, getSecret(), { expiresIn: '24h' });
    res.json({ token, email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/applicant/me/applications — 查看自己的投递详情 */
router.get('/me/applications', requireApplicant, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, job_id, job_title, job_category, status, submitted_at, updated_at
       FROM applications WHERE email = $1 ORDER BY submitted_at DESC`,
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

module.exports = router;
