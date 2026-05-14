/* ===== lib/mailer.js — Resend 邮件发送 ===== */

const { Resend } = require('resend');

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM = process.env.RESEND_FROM || 'about编辑部 <noreply@resend.dev>';

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

const EMAIL_TEMPLATES = {
  hired: {
    subject: '您的投递已通过审核 — about编辑部',
    html: (name, jobTitle) => `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部</p>
  </div>

  <p style="font-size:15px;">您好，${name}，</p>

  <p style="font-size:15px;">
    感谢您投递「<strong>${jobTitle}</strong>」岗位。经过编辑团队的认真审阅，我们很高兴地通知您，您已通过本次筛选。
  </p>

  <p style="font-size:15px;">
    我们将在近期与您联系，进一步确认合作细节。请保持手机畅通，并留意邮件。
  </p>

  <p style="font-size:15px;">期待与您合作。</p>

  <p style="font-size:15px;margin-top:40px;">
    此致<br>
    <span style="color:#999;">about 编辑部</span>
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

  <p style="font-size:15px;">您好，${name}，</p>

  <p style="font-size:15px;">
    感谢您投递「<strong>${jobTitle}</strong>」岗位，以及您为此付出的时间与心思。
  </p>

  <p style="font-size:15px;">
    经过编辑团队的仔细评估，遗憾地通知您，本次我们未能选择与您合作。这并不代表对您能力的否定，而是与当前项目的具体需求有关。
  </p>

  <p style="font-size:15px;">
    我们会持续发布新的岗位需求，欢迎您关注并在合适的时候再次投递。
  </p>

  <p style="font-size:15px;margin-top:40px;">
    谢谢您对 about 编辑部的关注。<br>
    <span style="color:#999;">about 编辑部</span>
  </p>

  <div style="border-top:1px solid #e8e8e8;margin-top:40px;padding-top:20px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</div>`,
  },
};

async function sendOtpEmail(toEmail, code) {
  const resend = getResend();
  if (!resend) {
    console.warn('[mailer] RESEND_API_KEY not set, OTP code:', code);
    return;
  }
  console.log(`[mailer] sending OTP to ${toEmail}`);
  try {
    await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: '登录验证码 — about编辑部',
      html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">about编辑部</p>
  </div>
  <p style="font-size:15px;">您好，</p>
  <p style="font-size:15px;">您正在登录「about编辑部」投递状态查询页面，验证码为：</p>
  <div style="text-align:center;margin:32px 0;">
    <span style="font-size:36px;font-weight:700;letter-spacing:0.15em;color:#2d5a27;">${code}</span>
  </div>
  <p style="font-size:14px;color:#999;">验证码 5 分钟内有效，请勿泄露给他人。</p>
  <div style="border-top:1px solid #e8e8e8;margin-top:40px;padding-top:20px;">
    <p style="font-size:12px;color:#bbb;margin:0;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</div>`,
    });
  } catch (e) {
    console.error('[mailer] OTP send failed:', e.message);
  }
}

async function sendStatusEmail(toEmail, toName, jobTitle, status) {
  const resend = getResend();
  if (!resend) {
    console.warn('[mailer] RESEND_API_KEY not set, skipping email');
    return;
  }

  const tpl = EMAIL_TEMPLATES[status];
  if (!tpl) return; // 只发 hired / rejected

  console.log(`[mailer] sending "${status}" email to ${toEmail}`);
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: tpl.subject,
      html: tpl.html(toName, jobTitle),
    });
    console.log('[mailer] email sent, id:', result?.data?.id || result?.id);
  } catch (e) {
    console.error('[mailer] send failed:', e.message);
  }
}

async function sendHumanChatNotificationEmail(toEmail, payload = {}) {
  const resend = getResend();
  if (!toEmail) {
    console.warn('[mailer] chat notification skipped: no recipient email');
    return;
  }
  if (!resend) {
    console.warn('[mailer] RESEND_API_KEY not set, skipping chat notification to', toEmail);
    return;
  }

  const jobTitle = payload.jobTitle || '通用咨询';
  const assigneeName = payload.assigneeName || '同事';
  const reason = payload.reason || '需要人工确认';
  const lastQuestion = payload.lastQuestion || '';
  const chatUrl = payload.chatUrl || '';

  try {
    const result = await resend.emails.send({
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
    });
    console.log('[mailer] chat notification sent, id:', result?.data?.id || result?.id);
  } catch (e) {
    console.error('[mailer] chat notification failed:', e.message);
  }
}

module.exports = { sendStatusEmail, sendOtpEmail, sendHumanChatNotificationEmail };
