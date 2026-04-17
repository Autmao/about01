/* ===== lib/mailer.js — Resend 邮件发送 ===== */

const { Resend } = require('resend');

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM = process.env.RESEND_FROM || 'about编辑部 <noreply@resend.dev>';

const EMAIL_TEMPLATES = {
  hired: {
    subject: '您的投递已通过审核 — about编辑部',
    html: (name, jobTitle) => `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#2d2d2d;line-height:1.8;">
  <div style="border-bottom:1px solid #e8e8e8;padding-bottom:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">ABOUT 编辑部</p>
  </div>

  <p style="font-size:15px;">您好，${name}，</p>

  <p style="font-size:15px;">
    感谢您投递「<strong>${jobTitle}</strong>」工种。经过编辑团队的认真审阅，我们很高兴地通知您，您已通过本次筛选。
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
    <p style="font-size:13px;color:#999;margin:0;letter-spacing:0.05em;">ABOUT 编辑部</p>
  </div>

  <p style="font-size:15px;">您好，${name}，</p>

  <p style="font-size:15px;">
    感谢您投递「<strong>${jobTitle}</strong>」工种，以及您为此付出的时间与心思。
  </p>

  <p style="font-size:15px;">
    经过编辑团队的仔细评估，遗憾地通知您，本次我们未能选择与您合作。这并不代表对您能力的否定，而是与当前项目的具体需求有关。
  </p>

  <p style="font-size:15px;">
    我们会持续发布新的工种需求，欢迎您关注并在合适的时候再次投递。
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

module.exports = { sendStatusEmail };
