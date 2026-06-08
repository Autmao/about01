/* ===== routes/applicant.js — 投递者公开接口 ===== */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool, createOtp, verifyOtp, mapApp } = require('../db');
const { sendOtpEmail } = require('../lib/mailer');
const { decorateApplicationFiles } = require('../lib/storage');

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
   创作伙伴邮箱登录验证码 */
router.post('/send-otp', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid_email', message: '请输入有效的邮箱地址' });
    }

    const code = await createOtp(email);
    await sendOtpEmail(email, code);
    res.json({ ok: true });
  } catch (e) {
    console.error('[applicant] send-otp error:', e.message || e);
    if (e.code === 'email_not_configured' || e.code === 'email_send_failed') {
      return res.status(502).json({
        error: e.code,
        message: '验证码邮件暂时发送失败，请稍后再试。',
      });
    }
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
      `SELECT *
       FROM applications
       WHERE LOWER(email) = $1
       ORDER BY submitted_at DESC`,
      [req.applicantEmail]
    );
    res.json(rows.map(row => {
      const app = decorateApplicationFiles(mapApp(row));
      return {
        id: app.id,
        jobId: app.jobId,
        jobTitle: app.jobTitle,
        jobCategory: app.jobCategory,
        name: app.name,
        email: app.email,
        phone: app.phone,
        wechat: app.wechat,
        bio: app.bio,
        portfolioLinks: app.portfolioLinks || [],
        resumeUrl: app.resumeUrl || '',
        portfolioFiles: app.portfolioFiles || [],
        status: app.status,
        submittedAt: app.submittedAt,
        updatedAt: app.updatedAt,
      };
    }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
