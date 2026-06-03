/* ===== lib/mailer.js — Resend 邮件发送 ===== */

const { Resend } = require('resend');

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM = process.env.RESEND_FROM || 'about编辑部 <noreply@resend.dev>';

function compactErrorValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeMailError(e) {
  const parts = [];
  if (e?.message) parts.push(e.message);
  if (e?.statusCode || e?.status) parts.push(`status=${e.statusCode || e.status}`);
  const details = compactErrorValue(e?.data || e?.response?.data || e?.error);
  if (details && !parts.includes(details)) parts.push(details);
  return parts.filter(Boolean).join(' | ') || 'unknown mail provider error';
}

function createMailError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function requireResend(purpose) {
  const resend = getResend();
  if (resend) return resend;
  if (process.env.MAILER_CONSOLE_FALLBACK === 'true') return null;
  throw createMailError(
    'email_not_configured',
    `${purpose} failed: RESEND_API_KEY is not configured`
  );
}

async function sendWithResend(resend, params, purpose) {
  try {
    const result = await resend.emails.send(params);
    if (result?.error) {
      throw createMailError(
        'email_send_failed',
        `${purpose} failed: ${describeMailError(result.error)}`,
        result.error
      );
    }
    const id = result?.data?.id || result?.id || '';
    console.log(`[mailer] ${purpose} sent${id ? `, id: ${id}` : ''}`);
    return { ok: true, id };
  } catch (e) {
    if (e.code === 'email_send_failed' || e.code === 'email_not_configured') throw e;
    throw createMailError('email_send_failed', `${purpose} failed: ${describeMailError(e)}`, e);
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function textToHtml(text) {
  return escHtml(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');
}

function wrapStatusEmailHtml(bodyHtml) {
  return `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部</p>
  </div>
  <p style="font-size:15px;">${bodyHtml}</p>
  <div style="border-top:1px solid #e8e8e8;margin-top:40px;padding-top:20px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统发送，请勿直接回复。</p>
  </div>
</div>`;
}

const EMAIL_TEMPLATES = {
  hired: {
    subject: '您的投递已通过审核 — about编辑部',
    html: (name, jobTitle) => `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部</p>
  </div>

  <p style="font-size:15px;">您好，${escHtml(name)}，</p>

  <p style="font-size:15px;">
    恭喜！您投递的「<strong>${escHtml(jobTitle)}</strong>」岗位已通过审核，我们会尽快联系您确认合作细节。
  </p>

  <p style="font-size:15px;">期待与您合作。</p>

  <p style="font-size:15px;margin-top:40px;">
    <span style="color:#999;">about编辑部</span>
  </p>

  <div style="border-top:1px solid #e8e8e8;margin-top:40px;padding-top:20px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</div>`,
  },

  rejected: {
    subject: '关于您的投递 — about编辑部',
    html: (name, jobTitle) => `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部</p>
  </div>

  <p style="font-size:15px;">您好，${escHtml(name)}，</p>

  <p style="font-size:15px;">
    感谢您投递「<strong>${escHtml(jobTitle)}</strong>」岗位，本次暂未通过，欢迎关注我们后续的岗位发布。
  </p>

  <p style="font-size:15px;margin-top:40px;">
    <span style="color:#999;">about编辑部</span>
  </p>

  <div style="border-top:1px solid #e8e8e8;margin-top:40px;padding-top:20px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</div>`,
  },
};

async function sendOtpEmail(toEmail, code) {
  const resend = requireResend('OTP email');
  if (!resend) {
    console.warn('[mailer] MAILER_CONSOLE_FALLBACK enabled, OTP code:', code);
    return { ok: false, skipped: true, reason: 'console_fallback' };
  }
  console.log(`[mailer] sending OTP to ${toEmail}`);
  return sendWithResend(resend, {
    from: FROM,
    to: toEmail,
    subject: '登录验证码 — about编辑部 Open Call',
    html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部</p>
  </div>
  <p style="font-size:15px;">您好，</p>
  <p style="font-size:15px;">您正在登录「about编辑部 Open Call」，验证码为：</p>
  <div style="text-align:center;margin:32px 0;">
    <span style="font-size:36px;font-weight:700;letter-spacing:0.15em;color:#2d5a27;">${code}</span>
  </div>
  <p style="font-size:14px;color:#999;">验证码 5 分钟内有效，请勿泄露给他人。</p>
  <div style="border-top:1px solid #e8e8e8;margin-top:40px;padding-top:20px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</div>`,
  }, 'OTP email');
}

async function sendStatusEmail(toEmail, toName, jobTitle, status, overrides = {}) {
  const resend = requireResend(`${status} email`);
  if (!resend) {
    console.warn('[mailer] MAILER_CONSOLE_FALLBACK enabled, skipping status email');
    return { ok: false, skipped: true, reason: 'console_fallback' };
  }

  const tpl = EMAIL_TEMPLATES[status];
  if (!tpl) return { ok: false, skipped: true, reason: 'unknown_template' };
  const subject = String(overrides.subject || tpl.subject).trim();
  const body = String(overrides.body || '').trim();
  const html = body ? wrapStatusEmailHtml(textToHtml(body)) : tpl.html(toName, jobTitle);

  console.log(`[mailer] sending "${status}" email to ${toEmail}`);
  return sendWithResend(resend, {
    from: FROM,
    to: toEmail,
    subject,
    html,
  }, `${status} email`);
}

async function sendHumanChatNotificationEmail(toEmail, payload = {}) {
  const resend = getResend();
  if (!toEmail) {
    console.warn('[mailer] chat notification skipped: no recipient email');
    return;
  }
  if (!resend) {
    console.warn('[mailer] RESEND_API_KEY not set, skipping chat notification to', toEmail);
    return { ok: false, skipped: true, reason: 'missing_api_key' };
  }

  const jobTitle = payload.jobTitle || '通用咨询';
  const assigneeName = payload.assigneeName || '同事';
  const reason = payload.reason || '需要人工确认';
  const lastQuestion = payload.lastQuestion || '';
  const chatUrl = payload.chatUrl || '';

  try {
    return await sendWithResend(resend, {
      from: FROM,
      to: toEmail,
      subject: `有新的人工咨询需要处理｜${jobTitle}`,
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:20px;margin-bottom:28px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部 · 招募后台</p>
  </div>

  <p style="font-size:15px;">${escHtml(assigneeName)}，你好：</p>

  <p style="font-size:15px;">
    「<strong>${escHtml(jobTitle)}</strong>」有一条咨询已升级为人工处理。
  </p>

  <div style="background:#f7f5f0;border:1px solid #ebe5d8;border-radius:10px;padding:16px 18px;margin:22px 0;">
    <p style="font-size:13px;color:#777;margin:0 0 8px;">升级原因</p>
    <p style="font-size:15px;margin:0;">${escHtml(reason)}</p>
    ${lastQuestion ? `<p style="font-size:13px;color:#777;margin:16px 0 8px;">用户最近提问</p>
    <p style="font-size:15px;margin:0;white-space:pre-wrap;">${escHtml(lastQuestion)}</p>` : ''}
  </div>

  ${chatUrl ? `<p style="font-size:15px;margin:28px 0;">
    <a href="${escHtml(chatUrl)}" style="display:inline-block;background:#2d5a27;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;">进入后台回复</a>
  </p>` : ''}

  <p style="font-size:13px;color:#999;">如果这条咨询不属于你，可以进入后台重新指派负责人。</p>

  <div style="border-top:1px solid #e8e8e8;margin-top:36px;padding-top:18px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</div>`,
    }, 'chat notification email');
  } catch (e) {
    console.error('[mailer] chat notification failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendStatusEmail, sendOtpEmail, sendHumanChatNotificationEmail };
